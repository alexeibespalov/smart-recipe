import { describe, expect, it } from "vitest";
import { OpenAIRecipeGenerator } from "../src/llm/openai-generator.js";
import { accessoryHardwareRules, buildRecipeImagePrompt, buildRecipeInstructions } from "../src/llm/prompts.js";
import { MonsieurCuisineAdapter } from "../src/devices/mc/adapter.js";
import type { RecipeInput } from "../src/recipes/schema.js";
import type { RetrievedRecipePage } from "../src/retriever/types.js";

describe("LLM prompt guidance", () => {
  it("uses the requested locale instead of hardcoded prose", () => {
    const prompt = buildRecipeInstructions("de-DE");

    expect(prompt).toContain("set settings.locale to de-DE");
    expect(prompt).toContain("German as used in Germany");
    expect(prompt).toContain("Category IDs and German site IDs");
    expect(prompt).toContain("MULTI-LEVEL STEAMING OPTIMIZATION");
    expect(prompt).toContain("STEAMING PREHEAT CHOICE");
    expect(prompt).toContain("SCRAPE DOWN RULE");
    expect(prompt).toContain("GROSS VS. NET WEIGHT RULE");
    expect(prompt).toContain("FILL-LEVEL PHYSICS");
    expect(prompt).toContain("confit, poaching, boiling, braising");
    expect(prompt).toContain("PRACTICAL WEIGHING AND MARKET QUANTITIES");
    expect(prompt).toContain("Use scale steps only for amounts of about 30 g or more");
    expect(prompt).toContain("400 g or 500 g ground beef");
    expect(prompt).toContain("HEAT-UP TIME BUDGET");
    expect(prompt).toContain("Add heat-up time only when the step itself must bring cold contents up to cooking temperature");
    expect(prompt).toContain("For one-pot pasta, follow the official MC pattern");
    expect(prompt).toContain("package cooking time plus about 3 minutes");
    expect(prompt).toContain("optional short extra-cooking step");
    expect(prompt).toContain("COOKING POT LIQUID LEVEL");
    expect(prompt).toContain("500 ml/g liquid is only the minimum for steam generation");
    expect(prompt).toContain("usually about 1200-1800 g");
    expect(prompt).toContain("bei der Abfrage zu Aufheizen 'Ja' wählen");
    expect(prompt).toContain("bei der Abfrage zu Aufheizen 'Nein' wählen");
    expect(prompt).toContain("mit dem Spatel nach unten schieben");
    expect(prompt).toContain("{ingredient} schälen/putzen (ergibt ca. {net} g)");
    expect(prompt).toContain("Nach dem Mixen heißer Zutaten ca. 10 Sekunden warten");
    expect(prompt).toContain("in ca. 3–4 cm große Stücke schneiden");
    expect(prompt).toContain("mindestens 500 ml Flüssigkeit in den Mixbehälter geben");
    expect(prompt).toContain("Öl langsam auf den Deckel gießen");
    expect(prompt).toContain("Mixbehälter und Rühraufsatz müssen absolut sauber, trocken und fettfrei sein");
    expect(prompt).toContain("durch die Deckelöffnung auf die laufenden Messer fallen lassen");
    expect(prompt).toContain("den Messbecher entfernen");
    expect(prompt).toContain("WEIGHING STATE CONSTRAINT");
    expect(prompt).toContain("CHOP-SCRAPE-SAUTÉ SEQUENCE");
    expect(prompt).toContain("TEMPERATURE CEILINGS FOR SENSITIVE INGREDIENTS");
    expect(prompt).toContain("MOISTURE REDUCTION");
    expect(prompt).toContain("STEAMER SETUP");
    expect(prompt).toContain("den Deckel des Mixbehälters abnehmen und den Dampfgaraufsatz direkt auf den Mixbehälter aufsetzen");
    expect(prompt).toContain("RAPID COOL-DOWN");
    expect(prompt).toContain("CONTINUOUS FEEDING");
    expect(prompt).toContain("PARALLEL PREP SEQUENCING");
    expect(prompt).toContain("GLOBAL TIMELINE OPTIMIZATION");
    expect(prompt).toContain("Die Kochzeit im folgenden Schritt nutzen, um {task}.");
  });

  it("supports the English locale guidance", () => {
    const prompt = buildRecipeInstructions("en-US");

    expect(prompt).toContain("set settings.locale to en-US");
    expect(prompt).toContain("English");
    expect(prompt).toContain("Category IDs and English site IDs");
    expect(prompt).toContain("select 'Yes' when asked to preheat");
    expect(prompt).toContain("select 'No' when asked to preheat");
    expect(prompt).toContain("scrape down the sides of the blender jug using the spatula");
    expect(prompt).toContain("GROSS VS. NET WEIGHT RULE");
    expect(prompt).toContain("FILL-LEVEL PHYSICS");
    expect(prompt).toContain("A pan amount such as 2-4 tbsp oil is only enough for sautéing/aromatics");
    expect(prompt).toContain("PRACTICAL WEIGHING AND MARKET QUANTITIES");
    expect(prompt).toContain("Do not use scale steps for spices");
    expect(prompt).toContain("normal to buy in the target country");
    expect(prompt).toContain("HEAT-UP TIME BUDGET");
    expect(prompt).toContain("COOKING POT LIQUID LEVEL");
    expect(prompt).toContain("potatoes, lentils, pasta, eggs");
    expect(prompt).toContain("Peel/trim {ingredient} (yields approx. {net} g)");
    expect(prompt).toContain("After pureeing hot contents, wait about 10 seconds");
    expect(prompt).toContain("cut into pieces of approx. 3-4 cm");
    expect(prompt).toContain("add at least 500 ml of liquid to the blender jug");
    expect(prompt).toContain("slowly pour the oil onto the lid so it trickles past the measuring beaker");
    expect(prompt).toContain("The blender jug and mixer attachment must be absolutely clean, dry, and fat-free");
    expect(prompt).toContain("drop through the lid opening onto the running blades");
    expect(prompt).toContain("remove the measuring beaker");
    expect(prompt).toContain("STEAMER SETUP");
    expect(prompt).toContain("remove the blender jug lid and lock the deep steamer attachment directly onto the blender jug");
    expect(prompt).toContain("PARALLEL PREP SEQUENCING");
    expect(prompt).toContain("GLOBAL TIMELINE OPTIMIZATION");
    expect(prompt).toContain("Use the cooking time in the following step to {task}.");
  });

  it("passes the requested locale into OpenAI generation", async () => {
    let request: unknown;
    const client = {
      chat: {
        completions: {
          create: async (body: unknown) => {
            request = body;
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      title: "Tomato Soup",
                      description: "A bright soup.",
                      settings: { locale: "en-US", complexityId: 22 },
                      categoryIds: [],
                      nutrients: [],
                      servingSize: {
                        amount: 4,
                        unit: "servings",
                        instruction: "",
                        preparationTime: 10,
                        readyInTime: 35,
                        ingredientGroups: [
                          {
                            name: "Soup",
                            ingredients: [
                              {
                                name: "tomatoes",
                                amount: 800,
                                unit: "g",
                                isOptional: false
                              }
                            ]
                          }
                        ],
                        steps: [
                          {
                            title: "Serve",
                            description: "Serve warm.",
                            mode: { type: "none" }
                          }
                        ]
                      }
                    })
                  }
                }
              ]
            };
          }
        }
      }
    };
    const generator = new OpenAIRecipeGenerator({
      client: client as unknown as ConstructorParameters<typeof OpenAIRecipeGenerator>[0]["client"],
      locale: "en-US",
      adapter: new MonsieurCuisineAdapter()
    });

    await generator.generate(pageFixture, { locale: "en-US" });

    const messages = (
      request as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages;

    expect(
      messages.find((message) => message.role === "system")?.content
    ).toContain("set settings.locale to en-US");

    expect(
      messages.find((message) => message.role === "user")?.content
    ).toContain("Preferred locale: en-US");
  });

  it("includes accessory and hardware rules with de-DE device terms", () => {
    const rules = accessoryHardwareRules("de-DE");

    expect(rules).toContain("Messereinsatz");
    expect(rules).toContain("Linkslauf");
    expect(rules).toContain("Rühraufsatz einsetzen");
    expect(rules).toContain("Kocheinsatz");
    expect(rules).toContain("Dampfgaraufsatz aufsetzen");
    expect(rules).toContain("flacher Dampfgaraufsatz");
    expect(rules).toContain("den Kocheinsatz mithilfe des Spatels herausnehmen");
    expect(rules).toContain("hotter than 60 C");
    expect(rules).toContain("den Messbecher entfernen");
    expect(rules).toContain("den Deckel des Mixbehälters abnehmen und den Dampfgaraufsatz direkt auf den Mixbehälter aufsetzen");
    expect(rules).toContain("Nach dem Mixen heißer Zutaten ca. 10 Sekunden warten");
    expect(rules).toContain("in ca. 3–4 cm große Stücke schneiden");
    expect(rules).toContain("mindestens 500 ml");
    expect(rules).toContain("500 ml/g is only enough to create steam");
    expect(rules).toContain("usually about 1200-1800 g");
  });

  it("encodes the Monsieur Cuisine Smart operating-manual limits", () => {
    const prompt = buildRecipeInstructions("en-US");

    expect(prompt).toContain("ROAST LOAD LIMIT");
    expect(prompt).toContain("at most 500 g of meat, fish or vegetables");
    expect(prompt).toContain("about 30 minutes before it can knead again");
    expect(prompt).toContain("approx. 1750 g");
    expect(prompt).toContain("dissolve the yeast in the lukewarm liquid first");
    expect(prompt).toContain("speed 0 is not available");
    expect(prompt).toContain("at most 10 minutes (600 s) per step");
    expect(prompt).toContain("about 1 l of water (1000 g)");
    expect(prompt).toContain("stacked on top of the deep one");
    expect(prompt).toContain("Put meat and fish in the deep (bottom) attachment");
    expect(prompt).not.toContain("splash guard");
    expect(prompt).not.toContain("Use speed 0");
  });

  it("converts US units by ingredient and keeps small amounts as spoons", () => {
    const prompt = buildRecipeInstructions("en-US");

    expect(prompt).toContain("US AND IMPERIAL UNITS");
    expect(prompt).toContain("all-purpose / plain flour 125 g");
    expect(prompt).toContain("1 stick = 1/2 cup = 113 g");
    expect(prompt).toContain("for liquids (water, milk, stock, juice, cream, wine) read it as fluid ounces");
    expect(prompt).toContain("14.5-15 oz can -> the European 400 g can");
    expect(prompt).toContain("350 °F = 175-180 °C");
    expect(prompt).toContain("\"all-purpose flour (2 cups)\"");
    expect(prompt).toContain("WEIGH OR SPOON");
    expect(prompt).toContain("never \"3 g ground cumin\" on the scale");
    expect(prompt).toContain("Never cups, oz, lb or sticks");
  });

  it("uses the Monsieur Cuisine English accessory names", () => {
    const rules = accessoryHardwareRules("en-US");

    for (const term of ["blade assembly", "mixer attachment", "cooking pot", "deep steamer attachment", "shallow steamer attachment", "measuring beaker"]) {
      expect(rules).toContain(term);
    }
    expect(rules).not.toMatch(/butterfly whisk|simmering basket|measuring cup/);
  });

  it("adds the official reference values and skips excluded modes", () => {
    const prompt = buildRecipeInstructions("en-US", ["foodProcessor"]);
    expect(prompt).toContain("OFFICIAL MONSIEUR CUISINE SMART REFERENCE VALUES");
    expect(prompt).toContain("Onions 1: speed 6, 8 seconds");
    expect(prompt).toContain("broccoli florets 12 min");
    expect(prompt).toContain("Proofing yeast dough");

    const withoutSteaming = buildRecipeInstructions("en-US", ["steam", "sousVide"]);
    expect(withoutSteaming).not.toContain("Steaming times");
    expect(withoutSteaming).not.toContain("Sous-vide:");
  });

  it("builds recipe image prompts from recipe and page context", () => {
    const prompt = buildRecipeImagePrompt(pageFixture, recipeFixture);

    expect(prompt).toContain("ambitious home cook");
    expect(prompt).toContain("not professional food photography");
    expect(prompt).toContain("Tomato Soup");
    expect(prompt).toContain("tomatoes");
    expect(prompt).toContain("Source recipe Markdown");
  });
});

const recipeFixture = {
  title: "Tomato Soup",
  description: "A bright soup with roasted tomatoes.",
  settings: {
    locale: "en-US",
    complexityId: 22
  },
  categoryIds: [],
  nutrients: [
    { name: "calories", unit: "kCal", amount: 180 },
    { name: "carbohydrate", unit: "g", amount: 20 },
    { name: "fat", unit: "g", amount: 8 },
    { name: "protein", unit: "g", amount: 4 }
  ],
  servingSize: {
    amount: 4,
    unit: "servings",
    instruction: "",
    preparationTime: 10,
    readyInTime: 35,
    ingredientGroups: [
      {
        name: "Soup",
        ingredients: [
          { name: "tomatoes", amount: 800, unit: "g", isOptional: false }
        ]
      }
    ],
    steps: [
      {
        title: "Cook",
        description: "Cook and blend until smooth.",
        mode: { type: "none" as const }
      }
    ]
  }
} as RecipeInput;

const pageFixture: RetrievedRecipePage = {
  url: "https://example.test/soup",
  finalUrl: "https://example.test/soup",
  title: "Tomato Soup",
  markdown: "# Tomato Soup\n\nRoast tomatoes, then simmer and blend.",
  html: "",
  images: []
};
