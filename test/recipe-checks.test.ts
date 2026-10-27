import { describe, expect, it } from "vitest";
import { MonsieurCuisineAdapter } from "../src/devices/mc/adapter.js";
import { buildRecipeGenerationRequest } from "../src/llm/generation-request.js";
import { checkRecipeInput } from "../src/pipeline/recipe-checks.js";
import { promptModeToRawMode } from "../src/recipes/modes.js";
import type { RetrievedRecipePage } from "../src/retriever/types.js";
import { soupWithStep6Mode, validSoup } from "./fixtures/mc-recipes.js";

function page(overrides: Partial<RetrievedRecipePage> = {}): RetrievedRecipePage {
  return { url: "", finalUrl: "", title: "Tomato soup", markdown: "Tomato soup for 2.", html: "", images: [], ...overrides };
}

describe("checkRecipeInput", () => {
  const adapter = new MonsieurCuisineAdapter();

  it("accepts a valid assistant-written recipe and returns the finalized input", () => {
    const result = checkRecipeInput(adapter, validSoup);
    expect(result.kind).toBe("ok");
  });

  it("reports device limits with the failing step path", () => {
    const result = checkRecipeInput(adapter, soupWithStep6Mode({ speed: 5 }));
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.errors).toContain("/servingSize/steps/6/mode/speed must be <= 3");
    expect(new Set(result.errors).size).toBe(result.errors.length);
  });

  it("rejects excluded accessory modes", () => {
    const result = checkRecipeInput(adapter, soupWithStep6Mode({ type: "foodProcessor", minutes: 0, seconds: 30, temperature: undefined, speed: undefined, rotationDirection: undefined }), {
      excludeModes: ["foodProcessor"]
    });
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.errors.some((error) => error.includes("must not be \"foodProcessor\""))).toBe(true);
  });

  it("reports missing required fields", () => {
    const result = checkRecipeInput(adapter, { title: "x" });
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.errors).toContain("/ must have required property 'servingSize'");
  });
});

describe("buildRecipeGenerationRequest", () => {
  const adapter = new MonsieurCuisineAdapter();

  it("includes locale, schema and source text for text recipes", () => {
    const request = buildRecipeGenerationRequest(page(), adapter, { locale: "en-US" });
    expect(request.sourcePolicy).toBe("adapt");
    expect(request.userPrompt).toContain("Preferred locale: en-US");
    expect(request.userPrompt).toContain("Full schema with detailed descriptions:");
    expect(request.userPrompt).toContain("Tomato soup for 2.");
    expect(request.systemPrompt).toContain("en-US");
  });

  it("uses machine fidelity for official Cookidoo sources", () => {
    const url = "https://cookidoo.de/recipes/recipe/de-DE/r66613";
    const request = buildRecipeGenerationRequest(page({ url, finalUrl: url }), adapter, { locale: "de-DE" });
    expect(request.sourcePolicy).toBe("machine-fidelity");
  });

  it("embeds correction feedback when given", () => {
    const request = buildRecipeGenerationRequest(page(), adapter, { locale: "en-US" }, {
      errors: ["/servingSize/steps/6/mode/speed must be <= 3"],
      previous: { title: "draft" }
    });
    expect(request.userPrompt).toContain("Previous generated JSON failed validation.");
    expect(request.userPrompt).toContain("/servingSize/steps/6/mode/speed must be <= 3");
  });
});

describe("Monsieur Cuisine manual cooking limits", () => {
  const adapter = new MonsieurCuisineAdapter();

  it("rejects speed 0, which the device does not offer", () => {
    const result = checkRecipeInput(adapter, soupWithStep6Mode({ speed: 0 }));
    expect(result.kind).toBe("invalid");
  });

  it("caps speed 7-10 at 10 minutes", () => {
    const tooLong = checkRecipeInput(adapter, soupWithStep6Mode({ temperature: 0, rotationDirection: "right", speed: 8, minutes: 11, seconds: 0 }));
    expect(tooLong.kind).toBe("invalid");
    if (tooLong.kind === "invalid") {
      expect(tooLong.errors.some((error) => error.includes("600 seconds (10 minutes) or less at speed 7-10"))).toBe(true);
    }

    const atLimit = checkRecipeInput(adapter, soupWithStep6Mode({ temperature: 0, rotationDirection: "right", speed: 8, minutes: 10, seconds: 0 }));
    expect(atLimit.kind).toBe("ok");
  });
});

describe("heatWater mode", () => {
  const adapter = new MonsieurCuisineAdapter();

  function soupWithHeatWater(mode: Record<string, unknown>): unknown {
    const copy: { servingSize: { steps: Array<{ title: string; description?: string; mode: Record<string, unknown> }> } } = structuredClone(validSoup);
    const step = copy.servingSize.steps[6];
    if (!step) throw new TypeError("fixture is missing step 6");
    step.title = "Heat water";
    step.description = "";
    step.mode = mode;
    return copy;
  }

  it("converts to the payload shape the Monsieur Cuisine API accepts", () => {
    expect(promptModeToRawMode({ type: "heatWater", temperature: 100 })).toEqual({
      type: "heat_water",
      modeSetting: null,
      deviceSettings: [{ order: 0, temperature: 100 }]
    });
  });

  it("accepts boiling water and rejects off-step temperatures or extra fields", () => {
    expect(checkRecipeInput(adapter, soupWithHeatWater({ type: "heatWater", temperature: 100 })).kind).toBe("ok");
    expect(checkRecipeInput(adapter, soupWithHeatWater({ type: "heatWater", temperature: 97 })).kind).toBe("invalid");
    expect(checkRecipeInput(adapter, soupWithHeatWater({ type: "heatWater", temperature: 100, minutes: 5 })).kind).toBe("invalid");
  });

  it("is described to the model", () => {
    const prompt = buildRecipeGenerationRequest(page(), adapter, { locale: "en-US" }).systemPrompt;
    expect(prompt).toContain("heatWater: temperature steps");
    expect(prompt).toContain("At most 1.5 l of water");
  });
});
