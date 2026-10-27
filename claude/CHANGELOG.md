# Smart Cooker extension — changelog

Released files live in `releases/` as `smart-cooker-<version>.mcpb`. Build with `npm run build:claude -- --bump patch|minor|major`.

## 0.3.2 — 2026-10-27

- The food-processor attachment is on by default (setting "I own the Monsieur Cuisine food processor
  attachment"), so recipes may use the slicing/grating mode.

## 0.3.1 — 2026-10-27

- Recipe list card: a search now says "1 match for “sauerkraut” (of 34)" instead of the account total, and a
  partial list says "showing 20 of 34".

## 0.3.0 — 2026-10-27

- 🎉 Recipe cards in Claude Desktop Chat (MCP App): after sending a recipe, a colourful card shows the photo, servings
  and timings, nutrients, the ingredient table (⚖️ marks what the scale weighs) and every step colour-coded by what
  the machine does, with mode badges and time/temperature/speed chips; confetti when it's on the cooker, an amber
  card with the reason when Monsieur Cuisine kept it as a draft, and an "Open in Monsieur Cuisine" button.
- "What's on my cooker?" shows a grid of recipe tiles with thumbnails, 📱 On cooker / 📝 Draft badges and dates.
- Light and dark themes follow Claude Desktop.

## 0.2.0 — 2026-10-24

First versioned release. Claude writes the recipe; the extension fetches, checks and uploads it (no AI key).

- Monsieur Cuisine recipes are published **privately** right after upload (the API always creates a draft first); never submitted to the community. `draft` only on explicit request; a refused publish is reported with the reason.
- Rules from the official operating manual: speed 1-10 (no speed 0), speed 7-10 at most 10 min, Roast at most 500 g, kneading cooldown, steamer water, accessory names, official reference times and temperatures.
- Heat Water mode (`heat_water`, target temperature, at most 1.5 l).
- US units converted by ingredient (cups, oz, lb, sticks, cans, °F); weigh only about 30 g or more, spoons below that.
- Conversation guidance is built into the tools, so no separate skill is needed.

## 0.1.0

Unversioned development builds (all reported 0.1.0).
