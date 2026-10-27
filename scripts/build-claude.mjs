#!/usr/bin/env node
// Builds the Claude Desktop extension: the bundled Smart Cooker MCP server, whose tool descriptions and results
// carry the whole conversation workflow (no separate skill needed).
//
// The version lives in claude/desktop-extension/manifest.json. Each build writes the versioned, git-tracked
// claude/releases/smart-cooker-<version>.mcpb (plus build/claude/smart-cooker.mcpb as a scratch copy) and refuses
// to overwrite an existing release, so every installed file has a unique version.
//
// Usage: npm run build:claude                 build the current version (must not be released yet)
//        npm run build:claude -- --bump patch bump patch/minor/major in the manifest first, then build
//        npm run build:claude -- --force      rebuild and overwrite the current version's release
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "build", "claude");
const serverDir = path.join(out, "server");
const extensionDir = path.join(out, "extension");
const sources = path.join(root, "claude");
const releasesDir = path.join(sources, "releases");
const manifestPath = path.join(sources, "desktop-extension", "manifest.json");
const require = createRequire(path.join(root, "package.json"));
const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

const args = process.argv.slice(2);
const bumpIndex = args.indexOf("--bump");
const bump = bumpIndex === -1 ? undefined : args[bumpIndex + 1];
const force = args.includes("--force");

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, part) {
  const [major, minor, patch] = version.split(".").map(Number);
  if ([major, minor, patch].some((n) => !Number.isInteger(n))) throw new Error(`Manifest version '${version}' is not x.y.z.`);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  if (part === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`--bump expects patch, minor or major, not '${part ?? ""}'.`);
}

// 1. Resolve the version and make sure it has not been released yet.
const sourceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (bump !== undefined) {
  sourceManifest.version = bumpVersion(sourceManifest.version, bump);
  writeJson(manifestPath, sourceManifest);
  console.log(`Bumped extension version to ${sourceManifest.version}`);
}
const { version } = sourceManifest;
const releasePath = path.join(releasesDir, `smart-cooker-${version}.mcpb`);
if (fs.existsSync(releasePath) && !force) {
  console.error(`${path.relative(root, releasePath)} already exists. Use --bump patch|minor|major for a new version, or --force to rebuild this one.`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });

// 2. The server bundle and the recipe-card view (tsup.claude.config.ts reads the same manifest version).
execFileSync(bin("tsup"), ["--config", "tsup.claude.config.ts"], { cwd: root, stdio: "inherit" });

// The card view is one self-contained HTML file (MCP Apps views load no files of their own).
const cardTemplate = fs.readFileSync(path.join(root, "src", "mcp", "ui", "card.html"), "utf8");
const cardCss = fs.readFileSync(path.join(root, "src", "mcp", "ui", "card.css"), "utf8");
const cardJs = fs.readFileSync(path.join(out, "ui", "card.global.js"), "utf8").replaceAll("</script", "<\\/script");
const cardHtml = cardTemplate.split("/*__CARD_CSS__*/").join(cardCss).split("/*__CARD_JS__*/").join(cardJs);
fs.writeFileSync(path.join(out, "ui", "card.html"), cardHtml);

/** Copies the server runtime (bundle, card view, Playwright, ESM marker, license) into the extension directory. */
function addServerRuntime(target) {
  fs.cpSync(serverDir, path.join(target, "server"), { recursive: true });
  fs.mkdirSync(path.join(target, "ui"), { recursive: true });
  fs.copyFileSync(path.join(out, "ui", "card.html"), path.join(target, "ui", "card.html"));
  // Playwright stays a real package: it loads injected scripts and its CLI (browser install) from disk.
  for (const name of ["playwright", "playwright-core"]) {
    const source = path.dirname(require.resolve(`${name}/package.json`));
    fs.cpSync(source, path.join(target, "node_modules", name), { recursive: true, dereference: true });
  }
  // The bundle is ESM; Node needs this to load server/index.js as a module.
  fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify({ name: "smart-cooker", private: true, type: "module" }, null, 2)}\n`);
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(target, "LICENSE"));
}

// 3. Pack the extension.
fs.mkdirSync(extensionDir, { recursive: true });
writeJson(path.join(extensionDir, "manifest.json"), sourceManifest);
fs.copyFileSync(path.join(sources, "desktop-extension", "icon.png"), path.join(extensionDir, "icon.png"));
addServerRuntime(extensionDir);
execFileSync(bin("mcpb"), ["validate", path.join(extensionDir, "manifest.json")], { cwd: root, stdio: "inherit" });
const packed = path.join(out, "smart-cooker.mcpb");
execFileSync(bin("mcpb"), ["pack", extensionDir, packed], { cwd: root, stdio: "inherit" });

// 4. Keep the versioned release.
fs.mkdirSync(releasesDir, { recursive: true });
fs.copyFileSync(packed, releasePath);
console.log(`\nReleased ${path.relative(root, releasePath)} (version ${version})`);
