import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { OpenAIRecipeGenerator } from "../src/llm/openai-generator.js";
import { MonsieurCuisineAdapter } from "../src/devices/mc/adapter.js";
import type { RetrievedRecipePage } from "../src/retriever/types.js";

function recipeWithPureeTime(minutes: number, seconds: number) {
  return {
    title: "Kremova polevka",
    description: "Polevka.",
    settings: { locale: "cs-CZ", complexityId: 537 },
    status: "draft",
    categoryIds: [324],
    nutrients: [],
    servingSize: {
      amount: 2,
      unit: "porce",
      instruction: "",
      preparationTime: 5,
      readyInTime: 20,
      ingredientGroups: [{ name: "Suroviny", ingredients: [{ name: "brambory", amount: 300, unit: "g", isOptional: false }] }],
      steps: [
        { title: "Priprava", description: "Vlozte brambory.", mode: { type: "none" } },
        { title: "Rozmixujte", description: "", mode: { type: "puree", minutes, seconds } }
      ]
    }
  };
}

const page: RetrievedRecipePage = {
  url: "https://example.com/recipe",
  finalUrl: "https://example.com/recipe",
  title: "Polevka",
  markdown: "# Polevka",
  html: "",
  images: []
};

describe("OpenAIRecipeGenerator correction loop", () => {
  it("sends out-of-range mode times back to the model instead of failing the import", async () => {
    const prompts: string[] = [];
    const outputs = [recipeWithPureeTime(0, 5), recipeWithPureeTime(1, 0)];
    const client = {
      responses: {
        create: async (params: { input: Array<{ content: Array<{ type: string; text?: string }> }> }) => {
          prompts.push(params.input[0].content[0].text ?? "");
          return { output_text: JSON.stringify(outputs[prompts.length - 1]) };
        }
      }
    } as unknown as OpenAI;

    const generator = new OpenAIRecipeGenerator({ client, adapter: new MonsieurCuisineAdapter(), locale: "cs-CZ" });
    const result = await generator.generate(page);

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("failed validation");
    expect(prompts[1]).toContain("/servingSize/steps/1/mode");
    expect(prompts[1]).toContain("puree.time must be an integer from 30 to 120");
    const puree = result.servingSize.steps[1].mode as { type: string; minutes: number; seconds: number };
    expect(puree.minutes * 60 + puree.seconds).toBe(60);
  });

  it("gives up with a clear error when the model keeps returning out-of-range values", async () => {
    const client = {
      responses: {
        create: async () => ({ output_text: JSON.stringify(recipeWithPureeTime(0, 5)) })
      }
    } as unknown as OpenAI;

    const generator = new OpenAIRecipeGenerator({ client, adapter: new MonsieurCuisineAdapter(), locale: "cs-CZ", maxCorrectionAttempts: 1 });
    await expect(generator.generate(page)).rejects.toThrow(/puree\.time must be an integer from 30 to 120/);
  });
});
