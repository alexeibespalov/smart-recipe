# Smart Cooker extension — changelog

Released files live in `releases/` as `smart-cooker-<version>.mcpb`. Build with `npm run build:claude -- --bump patch|minor|major`.

## 0.2.0 — 2026-10-24

First versioned release. Claude writes the recipe; the extension fetches, checks and uploads it (no AI key).

- Monsieur Cuisine recipes are published **privately** right after upload (the API always creates a draft first); never submitted to the community. `draft` only on explicit request; a refused publish is reported with the reason.
- Rules from the official operating manual: speed 1-10 (no speed 0), speed 7-10 at most 10 min, Roast at most 500 g, kneading cooldown, steamer water, accessory names, official reference times and temperatures.
- Heat Water mode (`heat_water`, target temperature, at most 1.5 l).
- US units converted by ingredient (cups, oz, lb, sticks, cans, °F); weigh only about 30 g or more, spoons below that.
- Conversation guidance is built into the tools, so no separate skill is needed.

## 0.1.0

Unversioned development builds (all reported 0.1.0).
