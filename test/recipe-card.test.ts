import { describe, expect, it } from "vitest";
import { buildRecipeCard, titleEmoji } from "../src/recipes/recipe-card.js";
import { soupWithStep6Mode, validSoup } from "./fixtures/mc-recipes.js";

describe("buildRecipeCard (Monsieur Cuisine)", () => {
  const card = buildRecipeCard(validSoup, "mc");

  it("carries the title, emoji, metrics and nutrients with CLI labels", () => {
    expect(card.title).toBe("Silky Tomato Soup");
    expect(card.emoji).toBe("🍲");
    expect(card.metrics.map((metric) => metric.icon)).toEqual(["👥", "🕒", "🏁", "📊"]);
    expect(card.metrics[0]?.text).toBe("2 servings");
    expect(card.metrics[3]?.text).toBe("Easy");
    expect(card.nutrients.map((nutrient) => nutrient.text)).toEqual(["150 kCal", "16 g Carbs", "8 g Fat", "4 g Protein"]);
    expect(card.labels).toEqual({ ingredients: "Ingredients", steps: "Steps", optional: "optional" });
  });

  it("marks ingredients that have a scale step", () => {
    const items = card.ingredientGroups[0]?.items ?? [];
    expect(items.find((item) => item.name.includes("tomatoes"))).toMatchObject({ amount: "400", unit: "g", weighed: true });
    expect(items.find((item) => item.name === "salt")).toMatchObject({ weighed: false });
  });

  it("colours steps by what the machine does and shows the settings as chips", () => {
    const byTitle = (title: string) => card.steps.find((step) => step.title === title)?.mode;
    expect(card.steps[0]?.mode).toBeNull();
    expect(byTitle("Chop onion")).toMatchObject({ tone: "motor", emoji: "🔄", label: "Manual Cooking" });
    expect(byTitle("Weigh oil")).toMatchObject({ tone: "weigh", chips: [{ icon: "⚖️", text: "15 g" }] });
    expect(byTitle("Sauté onion")).toMatchObject({ tone: "heat", chips: [{ text: "3m" }, { text: "120 °C" }] });
    expect(byTitle("Simmer soup")?.chips).toEqual([
      { icon: "⏱", text: "15m" },
      { icon: "🌡", text: "100 °C" },
      { icon: "🌀", text: "Speed 1 ↺" }
    ]);
  });

  it("shows Heat Water as a heating step with its target temperature", () => {
    const step = buildRecipeCard(soupWithStep6Mode({}), "mc");
    expect(step.steps).toHaveLength(9);
    const heatWater = buildRecipeCard(
      { ...validSoup, servingSize: { ...validSoup.servingSize, steps: [{ title: "Boil water", description: "", mode: { type: "heatWater", temperature: 100 } }] } },
      "mc"
    ).steps[0]?.mode;
    expect(heatWater).toEqual({ label: "Heat Water", emoji: "🫖", tone: "heat", chips: [{ icon: "🌡", text: "100 °C" }] });
  });
});

describe("buildRecipeCard (Thermomix)", () => {
  it("turns guided settings into chips on the step text", () => {
    const card = buildRecipeCard({
      title: "Lentil curry",
      prepTime: 10,
      totalTime: 35,
      servingSize: 4,
      servingUnitText: "portions",
      ingredients: [{ id: "lentils", text: "200 g red lentils" }],
      steps: [{ text: "Cook 20 min/100°C/reverse/speed 1", modeAnnotations: [{ matchedSubstring: "20 min/100°C", mode: { type: "cook", time: 1200, temperature: 100, speed: "1", direction: "CCW" } }] }],
      hints: "",
      settings: { locale: "en-US" }
    }, "tm");
    expect(card.emoji).toBe("🍛");
    expect(card.ingredientGroups[0]?.items[0]?.name).toBe("200 g red lentils");
    expect(card.steps[0]?.mode).toMatchObject({ label: "Cook", tone: "heat", chips: [{ text: "20m" }, { text: "100 °C" }, { text: "Speed 1 ↺" }] });
  });
});

describe("titleEmoji", () => {
  it("picks a food emoji from the title, with a plate as fallback", () => {
    expect(titleEmoji("Sourdough Baguettes")).toBe("🍞");
    expect(titleEmoji("Chicken Enchiladas")).toBe("🌮");
    expect(titleEmoji("Cucumber Margarita")).toBe("🥤");
    expect(titleEmoji("Something new")).toBe("🍽️");
  });
});
