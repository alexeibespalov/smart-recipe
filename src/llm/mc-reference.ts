import type { PromptModeType } from "../recipes/types.js";

// Reference values from the official Monsieur Cuisine Smart (SKMS 1200 C1) operating instructions.
// The model uses them instead of guessing times, speeds and temperatures.

const CHOPPING_AND_GRINDING = [
  "Almonds 200 g: speed 10, 10 seconds",
  "Apples (in pieces) 600 g: speed 5, 6 seconds",
  "Bread rolls 1: speed 8, 20 seconds",
  "Buckwheat 250 g: speed 10, 1 minute",
  "Cabbage (red/white) 500 g: speed 6, 8 seconds",
  "Carrots (sliced, approx. 5 cm) 500 g: speed 6, 8 seconds",
  "Chocolate/chocolate coating 200 g: speed 8, 15 seconds",
  "Coffee beans 100 g: speed 10, 45 seconds",
  "Garlic 1 clove: speed 8, 5 seconds",
  "Herbs 20 g: speed 6, 8 seconds",
  "Ice cubes 250 g: Turbo 3 x 1 second",
  "Linseed 100 g: speed 10, 15 seconds",
  "Meat (frozen) 100 g: speed 8, 16 seconds",
  "Nuts 200 g: speed 10, 10 seconds",
  "Oats 250 g: speed 10, 1 minute 30 seconds",
  "Onions 1: speed 6, 8 seconds",
  "Peppercorns 20 g: speed 10, 20 seconds",
  "Poppy seeds 250 g: speed 9, 35 seconds",
  "Potatoes (in pieces) 1 kg: speed 5, 10 seconds",
  "Rye 250 g: speed 10, 1 minute 30 seconds",
  "Sesame seeds 50 g: speed 10, 10 seconds",
  "Spelt 250 g: speed 10, 1 minute 30 seconds",
  "Spices 20 g: speed 10, 20 seconds",
  "Sugar 100 g: speed 10, 20 seconds",
  "Wheatberries 250 g: speed 10, 1 minute 30 seconds",
  "Wheatberries 500 g: speed 10, 2 minutes"
] as const;

const STIRRING_AND_PUREEING = [
  "Whipping chilled cream 200 g (mixer attachment): speed 3, 2-2.5 minutes, checking constantly",
  "Fruit, uncooked, purée 250 g: speed 9, 1 minute",
  "Vegetables, cooked, purée 250 g: speed 9, 45 seconds",
  "Vegetables, uncooked, purée 250 g: speed 9, 1 minute"
] as const;

const STEAMING_TIMES = [
  "Vegetables (500 g unless noted): asparagus whole 18 min; green beans whole 10 min; broccoli florets 12 min; Brussels sprouts 12 min; shredded cabbage 12 min; carrots 3 mm slices or whole very thin 12 min; cauliflower florets 15 min; courgettes 5 mm slices 12 min; fennel 1 cm slices 12 min; kohlrabi 1 cm slices 15 min; leek 1 cm rings 6 min; mangetout 200 g 8 min; sliced mushrooms 250 g 15 min; frozen peas 250 g 8 min; pepper 1 cm strips 10 min; potatoes 800 g peeled and quartered or small with skin 15 min; fresh spinach 250 g 7 min",
  "Fruit (500 g): apples or pears quartered 12 min; apricots or peaches halved 10 min; plums halved 12 min",
  "Meat: chicken or turkey breast fillet in portion-sized pieces 500 g 12 min; whole chicken or turkey breast fillet 150 g 15 min; meatballs 500 g 15 min",
  "Fish: mussels 1 kg 15 min; pollock fillet 1-4 pieces of 200 g, 2 cm thick 12 min; raw prawns 250 g 10 min; salmon fillet 1-4 pieces of 300 g, 3-4 cm thick 12 min; whole trout 2 x 250 g 15 min"
] as const;

const SOUS_VIDE = [
  "Format: weight, time, then core temperature rare / medium rare / medium / well done (- = not recommended)",
  "Saddle of venison, boned 600 g, 1 h: - / 52 / 55 / 62 °C",
  "Beef steaks 4 x 180 g, 2-3 cm thick, 1 h: 52 / 55 / 58 / 62 °C",
  "Beef tenderloin 800 g, 2 h: - / 54 / 59 / - °C",
  "Pork neck 800 g, 2 h 30 min: - / 60 / 65 / 72 °C",
  "Pork tenderloin 600-800 g, 1 h 30 min: - / 56 / 59 / 63 °C",
  "Chicken breast 4 x 150 g, 3-4 cm thick, 50 min: well done 70 °C",
  "Duck breast 2 x 300 g, 2-3 cm thick, 70 min: - / 58 / 60 / 70 °C",
  "Lamb fillet 500 g, 45 min: - / 62 / 65 / 70 °C",
  "Salmon fillet 4 x 125 g, 2-3 cm thick, 40 min: translucent 40 / tender 45 / firm 50 / cooked through 65 °C",
  "King prawns 20 pieces, 25 min: translucent 40 / tender 45 / firm 50 / cooked through 56 °C",
  "Vegetables and fruit at 85 °C: green asparagus 400 g 20 min; carrots 400 g halved lengthwise 1 h; green beans 400 g 1 h; pineapple, peaches, apricots or cherries 400 g in pieces 1 h; apples or pears 400 g in wedges 25 min",
  "Always put the vacuum-sealed (or air-squeezed, clipped freezer) bags in the cooking pot so the blades cannot touch them, and cover them completely with water below the MAX mark. Sear meat briefly in a frying pan afterwards."
] as const;

const SLOW_COOKING = [
  "The food always cooks in liquid (stock, juice, water or wine).",
  "Roast beef / boiled fillet 800 g in one piece with 1 l meat stock: 6 h at 85 °C",
  "Beef or pork goulash 800 g in 2 x 3 cm cubes with 500 ml meat stock: 4 h at 85 °C",
  "Pork chops 800 g in one piece with 1 l meat stock: 6 h at 85 °C",
  "Chicken cutlets 800 g in 1 cm strips with 500 ml meat stock: 1 h at 90 °C",
  "Fish stew: 1 kg bite-sized vegetables with 1 l vegetable or fish stock 2 h at 85 °C, then add 500 g bite-sized fish fillet for at most 30 min at 70 °C so it does not fall apart",
  "Vegetable stew: 1 kg bite-sized vegetables with 1 l vegetable stock: 2 h at 90 °C",
  "Compote: 800 g fruit in max. 2 cm cubes with 100 ml water and 3 tbsp sugar: 2 h at 90 °C",
  "Apple sauce / plum purée: 1.2 kg fruit in max. 2 cm cubes with 200 ml strained fruit juice: 5 h at 80 °C, then purée 1 min at speed 10 with the measuring beaker in place"
] as const;

const FERMENTATION = [
  "The blade turns only during the first 5 minutes, then stops.",
  "Yoghurt: 900 ml room-temperature UHT milk (3.5 % fat) + 100 g natural yoghurt, in the jug or 5 jars of 200 g: 8 h at 40 °C",
  "Cream cheese: 1500 ml cold fresh milk (3.5 % fat) + 200 g sour cream: 10 h at 65 °C",
  "Proofing yeast dough: put the kneaded dough in the deep steamer attachment, 250 ml water in the jug, cover all steamer vents with baking paper, close the lid: sweet dough 1 h at 50 °C, savoury/bread dough 1 h 30 min at 50 °C. Use this instead of 'let the dough rise' at room temperature."
] as const;

/** Official reference values as prompt text, skipping modes the user cannot use. */
export function mcOfficialReferenceValues(excludeModes: readonly PromptModeType[] = []): string {
  const excluded = new Set(excludeModes);
  const section = (title: string, rows: readonly string[]) => [`${title}:`, ...rows.map((row) => `- ${row}`)].join("\n");
  return [
    "OFFICIAL MONSIEUR CUISINE SMART REFERENCE VALUES (from the operating instructions). Use these instead of guessing; scale times sensibly for other quantities and cut sizes.",
    !excluded.has("manualCooking") && section("Chopping and grinding (manual cooking without heat; quantity: speed, time)", CHOPPING_AND_GRINDING),
    !excluded.has("manualCooking") && section("Stirring, whipping and puréeing", STIRRING_AND_PUREEING),
    !excluded.has("steam") && section("Steaming times (1 l water in the jug with the steamer attachments, 0.5 l with the cooking pot)", STEAMING_TIMES),
    !excluded.has("sousVide") && section("Sous-vide", SOUS_VIDE),
    !excluded.has("slowCooking") && section("Slow cooking", SLOW_COOKING),
    !excluded.has("fermentation") && section("Fermentation", FERMENTATION),
    !excluded.has("cookingEggs") && "Egg cooking: at most 5-6 eggs in the cooking pot with 0.5 l cold water in the jug; rinse with cold water afterwards if needed.",
    !excluded.has("smoothie") && "Smoothie: fill at most to the 1 l mark, e.g. 660 g solid ingredients + 350 g liquid for 4 glasses of 250 ml. Time by the firmest ingredient: soft fruit/vegetables 1 min, firmer 1 min 30 s, hard (firm apples, carrots, nuts, crushed ice) 2 min.",
    !excluded.has("puree") && "Purée programme: fixed speed 8 (preset 30 s), for soups and sauces."
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n\n");
}
