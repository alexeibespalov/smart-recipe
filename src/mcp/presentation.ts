import type { DeviceId } from "../devices/api.js";
import type { UploadedRecipeSummary } from "../pipeline/assistant-recipes.js";

// Conversation guidance for the Smart Cooker tools. It travels inside tool descriptions and tool results,
// so any MCP client follows the same workflow without a separate skill.

export const SERVER_INSTRUCTIONS = [
  "Smart Cooker puts recipes on the user's Monsieur Cuisine Smart (Lidl) or Thermomix (Cookidoo) account. Use it whenever the user shares a recipe link or recipe text and wants it on their cooker, asks what is on their machine, or needs to log in — even if they don't name the tool.",
  "You are the recipe AI: prepare_recipe gives you the device rules, schema and source; you write the recipe JSON; validate_recipe checks it; upload_recipe sends it. Nothing else generates the recipe.",
  "The user should never need a terminal, commands or API keys. Reply warmly and concisely with a cook-ready summary; never show raw JSON, stack traces or session cookies.",
  "If a tool returns status \"running\", call job_status with its job_id until it is done or failed."
].join("\n");

const COMMON_PRESENTATION = [
  "Present the recipe like this (warm, concise, scannable):",
  "- Title and a one-line description",
  "- Serves / timings, e.g. 4 portions · 15 min prep · 45 min total",
  "- Ingredients as a compact list (with group headings if present)",
  "- Steps numbered, one line each, machine settings highlighted, e.g. `3. 🔄 Sauté onions — ⏱ 5 min · 🌡 120 °C · Speed 1 ↺`",
  "Only describe settings that are in the validated JSON; never invent modes, speeds, temperatures or hardware features."
];

const MC_PRESENTATION = [
  "Monsieur Cuisine JSON: steps are in servingSize.steps; each step has title, description and mode. Durations are minutes + seconds.",
  "Mode labels: none 👩‍🍳 manual step · manualCooking 🔄 manual cooking (time, temperature °C where 0 = no heat, speed 1-10, rotationDirection left = ↺ reverse) · turbo ⚡ (seconds) · scale ⚖️ (grams) · roast 🍳 roast/sauté (temperature, time) · solid/soft/liquidDoughKnead 🥖 knead (time) · steam ♨️ steam at 120 °C (time) · sousVide 🌡 (temperature, time) · slowCooking 🍲 slow cook (temperature, time) · fermentation 🫙 ferment (temperature, time) · riceCooking 🍚 rice (time) · cookingEggs 🥚 eggs (size, texture; waxy_soft = medium-soft) · puree 🥣 · smoothie 🥤 · heatWater 🫖 heat water (temperature; 100 = until boiling) · foodProcessor 🔪 food processor attachment · precleaning 🧽 pre-clean.",
  "Accessory names: blender jug, blade assembly, cooking pot (hangs inside the jug), mixer attachment (whisk), measuring beaker, deep and shallow steamer attachment, spatula.",
  "If the user asks why something was changed, the device limits are: speed 1-3 when heating or in reverse; speed 7-10 at most 10 min; Turbo at most 20 s and only below 60 °C; speed 10 and Turbo at most 2.5 l liquid; Roast at most 500 g; kneading needs ~30 min before kneading again; the jug holds 3 l."
];

const TM_PRESENTATION = [
  "Thermomix JSON: title, prepTime/totalTime (minutes), servingSize, servingUnitText, ingredients[].text, steps[].text with modeAnnotations[].mode (times in seconds), hints.",
  "Mode labels: blend 🔄 (time, speed) · cook 🍲 (time, temperature, speed, direction CCW = ↺ reverse) · steaming ♨️ Varoma (time, speed, accessory) · browning 🍳 (time, temperature, power) · dough 🥖 · turbo ⚡ (pulse duration × count) · warmUp 🌡 (temperature, speed) · riceCooker 🍚."
];

/** How to show a recipe written for this device, returned with every brief. */
export function presentationGuide(device: DeviceId): string {
  return [...COMMON_PRESENTATION, ...(device === "tm" ? TM_PRESENTATION : MC_PRESENTATION)].join("\n");
}

export const AFTER_PREPARE =
  "Treat `instructions` as your system prompt and `task` as the request (it contains the full JSON schema and the source recipe). Write the recipe JSON exactly to the schema, then call validate_recipe (with source_url when there is one). If the page could not be read (paywall, login), ask the user to paste the recipe text.";

export const AFTER_VALID =
  "Valid. Show the recipe to the user using the presentation guide from prepare_recipe. If they clearly asked to send it (\"put this on my cooker\", \"send it\"), call upload_recipe now with the same device and source_url; otherwise ask \"Send it to your cooker?\". If they ask for changes, edit the JSON and validate again.";

export const AFTER_INVALID =
  "Fix exactly the fields named in errors (several anyOf errors on one step usually mean one wrong field) and call validate_recipe again. After about 4 failed rounds, tell the user briefly what the machine can't do.";

/** The sentence to tell the user after a successful upload. Only ever claim success from this. */
export function uploadConfirmation(device: DeviceId, summary: UploadedRecipeSummary): string {
  const link = summary.recipeUrl ? ` Web link: ${summary.recipeUrl}` : "";
  if (device === "tm") {
    return `Saved to Cookidoo Created Recipes; it appears on the Thermomix after it syncs.${link}`;
  }
  if (summary.status === "draft") {
    return `📝 Saved as a web draft — it won't show on the machine until it is published.${link}`;
  }
  return `📱 It's on the cooker screen under the created recipes.${link}`;
}

export const LIST_PRESENTATION =
  "Group the recipes as 📱 On cooker screen (status private-publish) and 📝 Web draft only (status draft). For each show the title, a friendly last-updated date, step/ingredient counts when present, and recipeUrl as a link.";

export const LOGIN_STARTED =
  "Tell the user: \"A login window for Monsieur Cuisine / Cookidoo is opening on your screen — log in there, then tell me when you're done.\" When they confirm, call job_status with this job_id, then check_connection, confirm in one line, and retry whatever failed.";

export const NOT_CONNECTED_HINT =
  "Offer to connect the account: call connect_account (it opens the official login window on the user's screen).";
