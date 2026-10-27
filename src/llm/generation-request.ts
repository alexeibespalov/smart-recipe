import type { TSchema } from "typebox";
import type { DeviceAdapter, DevicePromptOptions } from "../devices/adapter.js";
import type { RetrievedRecipePage } from "../retriever/types.js";
import { detectRecipeSource } from "../sources/index.js";
import type { RecipeSourcePolicy } from "./prompts.js";

export interface RecipeGenerationFeedback {
  errors: string[];
  previous: unknown;
}

export interface RecipeGenerationRequest {
  sourcePolicy: RecipeSourcePolicy;
  schema: TSchema;
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Builds the exact instructions, schema and source text used to turn a recipe page into a model-facing
 * recipe input. Shared by the built-in generator and by `prepare`, which hands it to an external assistant.
 */
export function buildRecipeGenerationRequest(
  page: RetrievedRecipePage,
  adapter: DeviceAdapter,
  options: DevicePromptOptions & { locale: string },
  feedback?: RecipeGenerationFeedback
): RecipeGenerationRequest {
  const schema = adapter.getSchema(options);
  const correctionText = feedback
    ? [
      "Previous generated JSON failed validation.",
      "Validation errors:",
      feedback.errors.join("\n"),
      "",
      "Previous JSON:",
      JSON.stringify(feedback.previous, null, 2),
      "",
      "Return corrected JSON only."
    ].join("\n")
    : "";

  const sourceUrl = page.finalUrl || page.url;
  const sourcePolicy: RecipeSourcePolicy =
    sourceUrl && detectRecipeSource(sourceUrl).type === "cookidoo-official"
      ? "machine-fidelity"
      : "adapt";

  const systemPrompt = adapter.getPromptInstructions(options.locale, {
    ...options,
    sourcePolicy
  });

  const userPrompt = [
    `Source URL: ${sourceUrl}`,
    `Detected title: ${page.title}`,
    `Preferred locale: ${options.locale}`,
    "",
    "Full schema with detailed descriptions:",
    JSON.stringify(schema, null, 2),
    correctionText,
    "",
    "Recipe page as Markdown:",
    page.markdown
  ].filter(Boolean).join("\n");

  return { sourcePolicy, schema, systemPrompt, userPrompt };
}
