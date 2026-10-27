import { localeComplexityIds } from "../catalogs/catalogs.js";
import type { CookidooRecipeInput } from "../devices/tm/schema.js";
import { formatDuration, formatMinutesOnly, getTranslation, type LocaleTranslation } from "./printer.js";
import type { RecipeInput } from "./schema.js";
import type { PromptModeInput } from "./types.js";

// A display model for a recipe card: plain JSON a UI paints without knowing either device's schema.
// Labels and units come from the CLI printer's translations, so the card says what the terminal says.

/** Drives a step's colour: what the machine is doing. */
export type CardTone = "heat" | "motor" | "weigh" | "steam" | "manual" | "clean";

export interface CardChip {
  icon: string;
  text: string;
}

export interface CardStep {
  n: number;
  title: string;
  text: string;
  mode: { label: string; emoji: string; tone: CardTone; chips: CardChip[] } | null;
}

export interface CardIngredient {
  amount: string;
  unit: string;
  name: string;
  optional: boolean;
  /** Weighed on the cooker's scale (a scale step targets this amount). */
  weighed: boolean;
}

export interface RecipeCard {
  device: "mc" | "tm";
  title: string;
  description: string;
  emoji: string;
  metrics: CardChip[];
  nutrients: CardChip[];
  ingredientGroups: Array<{ name: string; items: CardIngredient[] }>;
  steps: CardStep[];
  labels: { ingredients: string; steps: string; optional: string };
}

const TITLE_EMOJI: ReadonlyArray<[RegExp, string]> = [
  [/smoothie|shake|margarita|cocktail|lemonade|drink/i, "🥤"],
  [/soup|stew|chowder|broth|borscht|goulash|chili/i, "🍲"],
  [/curry|dal|tikka|masala/i, "🍛"],
  [/pasta|spaghetti|lasagn|noodle|risotto/i, "🍝"],
  [/pizza|focaccia/i, "🍕"],
  [/taco|burrito|enchilada|quesadilla|fajita/i, "🌮"],
  [/salad|bowl/i, "🥗"],
  [/bread|loaf|baguette|bun|roll|muffin|scone|biscuit/i, "🍞"],
  [/cake|brownie|cookie|cheesecake|dessert|pudding|tart|pie/i, "🍰"],
  [/chicken|turkey|duck/i, "🍗"],
  [/fish|salmon|cod|tuna|prawn|shrimp/i, "🐟"],
  [/beef|pork|lamb|meatball|burger|sausage/i, "🥩"],
  [/egg|omelet|frittata/i, "🍳"],
  [/rice|paella/i, "🍚"],
  [/sauce|dip|pesto|guacamole|hummus|salsa/i, "🥣"],
  [/jam|compote|marmalade/i, "🍓"]
];

export function titleEmoji(title: string): string {
  return TITLE_EMOJI.find(([pattern]) => pattern.test(title))?.[1] ?? "🍽️";
}

function chip(icon: string, text: string): CardChip {
  return { icon, text };
}

function duration(mode: { minutes?: number; seconds?: number }, t: LocaleTranslation): CardChip {
  return chip("⏱", formatDuration(mode.minutes ?? 0, mode.seconds ?? 0, t));
}

function speedChip(speed: number, reverse: boolean, t: LocaleTranslation): CardChip {
  return chip("🌀", `${t.speed} ${speed}${reverse ? " ↺" : ""}`);
}

/** The badge for one Monsieur Cuisine step mode. */
export function mcModeBadge(mode: PromptModeInput, t: LocaleTranslation): CardStep["mode"] {
  const label = mode.type === "none" ? "" : t.modes[mode.type];
  switch (mode.type) {
    case "none":
      return null;
    case "manualCooking": {
      const temperature = mode.temperature ?? 0;
      const chips = [duration(mode, t)];
      if (temperature > 0) chips.push(chip("🌡", `${temperature} °C`));
      chips.push(speedChip(mode.speed ?? 1, mode.rotationDirection === "left", t));
      return { label, emoji: temperature > 0 ? "🔥" : "🔄", tone: temperature > 0 ? "heat" : "motor", chips };
    }
    case "turbo":
      return { label, emoji: "⚡", tone: "motor", chips: [chip("⏱", `${mode.seconds ?? 0}${t.timeUnits.second}`)] };
    case "scale":
      return { label, emoji: "⚖️", tone: "weigh", chips: [chip("⚖️", `${mode.grams ?? 0} g`)] };
    case "roast":
      return { label, emoji: "🍳", tone: "heat", chips: [duration(mode, t), chip("🌡", `${mode.temperature ?? 0} °C`)] };
    case "solidDoughKnead":
    case "softDoughKnead":
    case "liquidDoughKnead":
      return { label, emoji: "🥖", tone: "motor", chips: [duration(mode, t)] };
    case "steam":
      return { label, emoji: "♨️", tone: "steam", chips: [duration(mode, t), chip("🌡", "120 °C")] };
    case "sousVide":
      return { label, emoji: "🌡", tone: "heat", chips: [duration(mode, t), chip("🌡", `${mode.temperature} °C`)] };
    case "slowCooking":
      return { label, emoji: "🍲", tone: "heat", chips: [duration(mode, t), chip("🌡", `${mode.temperature} °C`)] };
    case "fermentation":
      return { label, emoji: "🫙", tone: "heat", chips: [duration(mode, t), chip("🌡", `${mode.temperature} °C`)] };
    case "riceCooking":
      return { label, emoji: "🍚", tone: "heat", chips: [duration(mode, t)] };
    case "cookingEggs":
      return {
        label,
        emoji: "🥚",
        tone: "heat",
        chips: [chip("🥚", `${t.eggSizes[mode.size] ?? mode.size}, ${t.eggTextures[mode.texture] ?? mode.texture}`)]
      };
    case "precleaning":
      return { label, emoji: "🧽", tone: "clean", chips: [chip("🧽", t.cleanDurations[mode.duration] ?? mode.duration)] };
    case "foodProcessor":
      return { label, emoji: "🔪", tone: "motor", chips: [duration(mode, t)] };
    case "puree":
      return { label, emoji: "🥣", tone: "motor", chips: [duration(mode, t)] };
    case "smoothie":
      return { label, emoji: "🥤", tone: "motor", chips: [duration(mode, t)] };
    case "heatWater":
      return { label, emoji: "🫖", tone: "heat", chips: [chip("🌡", `${mode.temperature} °C`)] };
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function complexityLabel(recipe: RecipeInput, t: LocaleTranslation): string {
  const ids = localeComplexityIds[recipe.settings.locale];
  const id = recipe.settings.complexityId;
  if (ids?.easy === id) return t.complexityLevels.easy;
  if (ids?.hard === id) return t.complexityLevels.hard;
  return t.complexityLevels.medium;
}

function stripColon(label: string): string {
  return label.replace(/:\s*$/, "");
}

export function buildMcRecipeCard(recipe: RecipeInput): RecipeCard {
  const t = getTranslation(recipe.settings.locale);
  const scaleTargets = new Set(
    recipe.servingSize.steps.flatMap((step) => (step.mode.type === "scale" ? [step.mode.grams] : []))
  );
  const nutrient = (name: string) => recipe.nutrients.find((n) => n.name === name)?.amount;
  const nutrients: CardChip[] = [];
  const kcal = nutrient("calories");
  if (kcal !== undefined) nutrients.push(chip("🔥", `${kcal} kCal`));
  const carbs = nutrient("carbohydrate");
  if (carbs !== undefined) nutrients.push(chip("🍞", `${carbs} g ${t.nutrients.carbohydrate}`));
  const fat = nutrient("fat");
  if (fat !== undefined) nutrients.push(chip("🥑", `${fat} g ${t.nutrients.fat}`));
  const protein = nutrient("protein");
  if (protein !== undefined) nutrients.push(chip("🥩", `${protein} g ${t.nutrients.protein}`));

  return {
    device: "mc",
    title: recipe.title,
    description: recipe.description ?? "",
    emoji: titleEmoji(recipe.title),
    metrics: [
      chip("👥", `${recipe.servingSize.amount} ${recipe.servingSize.unit}`),
      chip("🕒", `${t.prepTime} ${formatMinutesOnly(recipe.servingSize.preparationTime, t)}`),
      chip("🏁", `${t.readyIn} ${formatMinutesOnly(recipe.servingSize.readyInTime, t)}`),
      chip("📊", complexityLabel(recipe, t))
    ],
    nutrients,
    ingredientGroups: recipe.servingSize.ingredientGroups.map((group) => ({
      name: group.name ?? "",
      items: group.ingredients.map((ingredient) => {
        const amount = String(ingredient.amount ?? "");
        const grams = ingredient.unit === "kg" ? Number(amount) * 1000 : Number(amount);
        return {
          amount,
          unit: ingredient.unit ?? "",
          name: ingredient.name,
          optional: Boolean(ingredient.isOptional),
          weighed: (ingredient.unit === "g" || ingredient.unit === "kg") && scaleTargets.has(grams)
        };
      })
    })),
    steps: recipe.servingSize.steps.map((step, index) => ({
      n: index + 1,
      title: step.title,
      text: step.description ?? "",
      mode: mcModeBadge(step.mode, t)
    })),
    labels: { ingredients: stripColon(t.ingredients), steps: stripColon(t.steps), optional: t.optional }
  };
}

type TmMode = NonNullable<CookidooRecipeInput["steps"][number]["modeAnnotations"]>[number]["mode"];

function seconds(total: number, t: LocaleTranslation): string {
  return formatDuration(Math.floor(total / 60), total % 60, t);
}

/** The badge for one Thermomix guided setting. */
export function tmModeBadge(mode: TmMode, t: LocaleTranslation): NonNullable<CardStep["mode"]> {
  const reverse = "direction" in mode && mode.direction === "CCW" ? " ↺" : "";
  switch (mode.type) {
    case "blend":
      return { label: "Blend", emoji: "🔄", tone: "motor", chips: [chip("⏱", seconds(mode.time, t)), chip("🌀", `${t.speed} ${mode.speed}`)] };
    case "cook":
      return {
        label: "Cook",
        emoji: "🍲",
        tone: "heat",
        chips: [chip("⏱", seconds(mode.time, t)), chip("🌡", `${mode.temperature} °C`), chip("🌀", `${t.speed} ${mode.speed}${reverse}`)]
      };
    case "steaming":
      return {
        label: "Varoma",
        emoji: "♨️",
        tone: "steam",
        chips: [chip("⏱", seconds(mode.time, t)), chip("🌀", `${t.speed} ${mode.speed}${reverse}`)]
      };
    case "browning":
      return { label: "Browning", emoji: "🍳", tone: "heat", chips: [chip("⏱", seconds(mode.time, t)), chip("🌡", `${mode.temperature} °C`)] };
    case "dough":
      return { label: "Dough", emoji: "🥖", tone: "motor", chips: [chip("⏱", seconds(mode.time, t))] };
    case "turbo":
      return { label: "Turbo", emoji: "⚡", tone: "motor", chips: [chip("⚡", `${mode.pulseCount ?? 1} × ${mode.pulseDuration} s`)] };
    case "warmUp":
      return { label: "Warm up", emoji: "🌡", tone: "heat", chips: [chip("🌡", `${mode.temperature} °C`), chip("🌀", `${t.speed} ${mode.speed}`)] };
    case "riceCooker":
      return { label: "Rice cooker", emoji: "🍚", tone: "heat", chips: [] };
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

export function buildTmRecipeCard(recipe: CookidooRecipeInput): RecipeCard {
  const t = getTranslation(recipe.settings.locale);
  return {
    device: "tm",
    title: recipe.title,
    description: recipe.hints ?? "",
    emoji: titleEmoji(recipe.title),
    metrics: [
      chip("👥", `${recipe.servingSize} ${recipe.servingUnitText}`),
      chip("🕒", `${t.prepTime} ${formatMinutesOnly(recipe.prepTime, t)}`),
      chip("🏁", `${t.readyIn} ${formatMinutesOnly(recipe.totalTime, t)}`)
    ],
    nutrients: [],
    ingredientGroups: [{ name: "", items: recipe.ingredients.map((ingredient) => ({ amount: "", unit: "", name: ingredient.text, optional: false, weighed: false })) }],
    steps: recipe.steps.map((step, index) => {
      const modes = (step.modeAnnotations ?? []).map((annotation) => tmModeBadge(annotation.mode, t));
      const first = modes[0];
      return {
        n: index + 1,
        title: step.text,
        text: "",
        mode: first ? { ...first, chips: modes.flatMap((mode) => mode.chips) } : null
      };
    }),
    labels: { ingredients: stripColon(t.ingredients), steps: stripColon(t.steps), optional: t.optional }
  };
}

/** Builds the card for a validated recipe input of either device. */
export function buildRecipeCard(recipe: unknown, device: "mc" | "tm"): RecipeCard {
  return device === "tm" ? buildTmRecipeCard(recipe as CookidooRecipeInput) : buildMcRecipeCard(recipe as RecipeInput);
}
