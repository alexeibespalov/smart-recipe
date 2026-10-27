# Smart Cooker for Claude Desktop

Claude writes recipes for a **Monsieur Cuisine Smart** or **Thermomix / Cookidoo** and sends them to your account.
Claude is the recipe AI — no Gemini/OpenAI key is needed. SmartRecipe only fetches the source, checks Claude's recipe
against the device limits and uploads it.

The extension is the only thing to install: **`releases/smart-cooker-<version>.mcpb`** (newest version = latest; see
[CHANGELOG.md](CHANGELOG.md)). It bundles SmartRecipe
and runs on Claude Desktop's built-in Node. The conversation workflow (when to use the tools, confirm before sending,
how to present recipes, how to log in) travels in the tools' descriptions and results, so no separate skill is needed.

## Build a new version

The version lives in `desktop-extension/manifest.json`. `npm run build:claude -- --bump patch` (or `minor` / `major`)
bumps it and writes `releases/smart-cooker-<new version>.mcpb`. Without `--bump` the build refuses to overwrite an
existing release (`--force` rebuilds it). Add a line to `CHANGELOG.md` for each release.

## Install

Double-click the newest `releases/smart-cooker-<version>.mcpb` (or drag it into **Settings → Extensions**) and click
**Install**. When updating, remove the old Smart Cooker extension first. In its settings
choose your default cooker, recipe language and whether you own the food-processor attachment.

## First use

Ask Claude: *"Connect my Monsieur Cuisine account"* (or Cookidoo). The official login page opens in a browser window;
log in once and the session is saved in `~/.smart-recipe`, shared with the CLI. The first login may take a minute while
the login browser downloads.

Then share any recipe: *"Put this on my cooker: https://…"*.

## Sources

- `desktop-extension/` — extension manifest (including the version) and icon
- `releases/` — every released `.mcpb`, tracked in git
- `../src/mcp/` — the MCP server (`presentation.ts` holds the conversation guidance); `../tsup.claude.config.ts` bundles it
