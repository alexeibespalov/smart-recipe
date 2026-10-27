import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("claude/desktop-extension/manifest.json", "utf8")) as { version: string };

// Self-contained Smart Cooker MCP server for the Claude Desktop extension: every dependency is bundled
// except Playwright, which ships browser-side assets and is copied next to the bundle as a package.
export default defineConfig([{
  entry: { index: "src/mcp/main.ts" },
  outDir: "build/claude/server",
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  // tsup's noExternal wins over external, so the bundle-everything pattern itself skips Playwright.
  noExternal: [/^(?!playwright(-core)?(\/|$))/],
  external: ["playwright", "playwright-core"],
  // Bundled CommonJS dependencies still call require() for Node built-ins.
  // The extension's own version (from its manifest), reported to MCP clients as serverInfo.version.
  define: { __SMART_COOKER_VERSION__: JSON.stringify(version) },
  banner: { js: 'import { createRequire as __smartCookerCreateRequire } from "node:module"; const require = __smartCookerCreateRequire(import.meta.url);' },
  splitting: false,
  sourcemap: false,
  dts: false,
  clean: true,
  minify: true
}, {
  // The recipe-card MCP Apps view: a browser script that scripts/build-claude.mjs inlines into ui/card.html.
  entry: { card: "src/mcp/ui/card.ts" },
  outDir: "build/claude/ui",
  format: ["iife"],
  platform: "browser",
  target: "es2020",
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  sourcemap: false,
  dts: false,
  clean: true,
  minify: true
}]);
