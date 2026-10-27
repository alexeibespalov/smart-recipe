// How to turn US/imperial recipe measures into what the Monsieur Cuisine scale and a European kitchen use.
// Volume-to-weight values are standard US kitchen equivalents (1 cup = 240 ml).

const WEIGHT_PER_CUP = [
  "all-purpose / plain flour 125 g (1 tbsp 8 g); bread flour 130 g; whole-wheat flour 120 g",
  "granulated sugar 200 g (1 tbsp 12.5 g); brown sugar, packed 220 g; powdered / icing sugar 120 g",
  "butter 227 g (1 stick = 1/2 cup = 113 g; 1 tbsp 14 g)",
  "water, stock, broth 240 g; milk, buttermilk, yogurt 245 g; heavy cream 240 g; sour cream 230 g",
  "vegetable or olive oil 218 g (1 tbsp 14 g); honey 340 g (1 tbsp 21 g); maple syrup 320 g",
  "uncooked rice 190 g; rolled oats 90 g; cocoa powder 85 g; chocolate chips 170 g; chopped nuts 120 g",
  "grated parmesan 100 g; shredded cheddar or mozzarella 113 g; chopped onion 160 g; canned tomatoes 240 g"
] as const;

const PLAIN_CONVERSIONS = [
  "Weight: 1 oz = 28 g; 1 lb = 454 g (then round to a normal package size, e.g. 1 lb ground beef -> 500 g pack, or 450 g when the jug or texture needs it).",
  "Volume: 1 tsp = 5 ml; 1 tbsp = 15 ml; 1 fl oz = 30 ml; 1 cup = 240 ml; 1 pint = 475 ml; 1 quart = 950 ml.",
  "\"oz\" is ambiguous: for liquids (water, milk, stock, juice, cream, wine) read it as fluid ounces (30 ml, about 30 g); for everything else as weight (28 g). \"fl oz\" is always volume.",
  "US cans: 14.5-15 oz can -> the European 400 g can; 28 oz can -> 800 g; 6 oz can tomato paste -> about 170 g.",
  "Temperatures in °F: convert to °C (e.g. 350 °F = 175-180 °C, 400 °F = 200 °C). Lengths in inches: 1 inch = 2.5 cm."
] as const;

/** Prompt rules for US/imperial source recipes and for choosing between the scale and spoons. */
export function measurementRules(): string {
  return [
    "US AND IMPERIAL UNITS: Source recipes often use cups, ounces, pounds, sticks, cans, °F and inches. Convert every quantity into grams (weighable ingredients), ml (only where grams would be misleading), or the target locale's spoons/pinches/pieces. Never output cups, oz, lb, sticks or °F. Cups are volume, so convert them by ingredient, not as 240 g:",
    ...WEIGHT_PER_CUP.map((row) => `- per cup: ${row}`),
    ...PLAIN_CONVERSIONS.map((row) => `- ${row}`),
    "When the source used US units, append the original measure in brackets to the ingredient name of the weighed ingredients so the user can cross-check, e.g. name \"all-purpose flour (2 cups)\", amount 250, unit \"g\".",
    "WEIGH OR SPOON: The scale weighs in 1 g steps but is unreliable at 5 g and below, and weighing tiny amounts is fiddly. Use a scale step only for ingredients of about 30 g or more. Below that, use teaspoons, tablespoons, pinches or pieces in a manual step, e.g. \"1 tsp ground cumin\", never \"3 g ground cumin\" on the scale. Keep spoon measures from the source as spoons unless the total is 30 g or more (e.g. 4 tbsp butter = 56 g may be weighed). Leavening and yeast always stay as spoons or packets (\"1 tsp baking powder\", \"1 packet (7 g) dry yeast\"). Countable items stay as pieces (eggs, garlic cloves, bay leaves) unless the recipe depends on their weight."
  ].join("\n");
}
