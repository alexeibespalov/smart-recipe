import OpenAI from "openai";
import type { RetrievedRecipePage } from "../retriever/types.js";
import type { RecipeInput } from "../recipes/schema.js";
import { applyCookidooSpeedRamps } from "../recipes/cookidoo-speed-ramp.js";
import { validateCookidooScaleSteps } from "../recipes/cookidoo-scale-fidelity.js";
import type { RecipeGenerationOptions, RecipeGenerator } from "./types.js";
import { makeOpenAIStrictSchema } from "./schema-format.js";
import { detectRecipeSource } from "../sources/index.js";
import { getArray, getRecord, getString } from "../utils/unknown.js";
import type { ReasoningEffort } from "./types.js";
import { promptModeToRawMode } from "../recipes/modes.js";
import type { PromptModeInput } from "../recipes/types.js";

type GenerationDefaults = Required<Omit<RecipeGenerationOptions, "adapter">> & Pick<RecipeGenerationOptions, "adapter">;

export interface OpenAIRecipeGeneratorOptions extends RecipeGenerationOptions {
  client?: OpenAI;
  adapter: NonNullable<RecipeGenerationOptions["adapter"]>;
}

export class OpenAIRecipeGenerator implements RecipeGenerator {
  private readonly client: OpenAI;
  private readonly defaults: GenerationDefaults;

  constructor(options: OpenAIRecipeGeneratorOptions) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;
    this.client = options.client ?? new OpenAI({
      apiKey: geminiKey ?? openAiKey,
      ...(geminiKey ? { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" } : {})
    });
    this.defaults = {
      model: options.model ?? process.env.GEMINI_MODEL ?? process.env.OPENAI_MODEL ?? (geminiKey ? "gemini-2.5-flash" : "gpt-4o-mini"),
      reasoningEffort: options.reasoningEffort ?? parseReasoningEffort(process.env.GEMINI_REASONING_EFFORT ?? process.env.OPENAI_REASONING_EFFORT),
      locale: options.locale ?? "de-DE",
      maxCorrectionAttempts: options.maxCorrectionAttempts ?? 3,
      excludeModes: options.excludeModes ?? [],
      adapter: options.adapter
    };
  }

  async generate(page: RetrievedRecipePage, options: RecipeGenerationOptions = {}): Promise<RecipeInput> {
    const cleanOptions = Object.fromEntries(
      Object.entries(options).filter(([_, v]) => v !== undefined)
    );
    const mergedOptions = { ...this.defaults, ...cleanOptions } as GenerationDefaults;
    if (!mergedOptions.adapter) {
      throw new Error("OpenAIRecipeGenerator requires a device adapter.");
    }
    const finalOptions = mergedOptions as Required<RecipeGenerationOptions>;
    let feedback: { errors: string[]; previous: unknown } | undefined;

    const adapter = finalOptions.adapter;
    const detectedSource = detectRecipeSource(page.finalUrl || page.url);
    const useCookidooFidelityFixes =
      adapter.id === "mc" &&
      detectedSource.type === "cookidoo-official";

    for (let attempt = 0; attempt <= finalOptions.maxCorrectionAttempts; attempt += 1) {
      const output = await this.generateOnce(page, finalOptions, feedback);
      const validation = adapter.validateInput(output);
      const excludedErrors = validateExcludedModes(output, finalOptions.excludeModes);
      const modeErrors = validation.ok ? validateModeSettings(output) : [];
      const scaleErrors = useCookidooFidelityFixes
        ? validateCookidooScaleSteps(output, page.markdown)
        : [];
      const allErrors = [
        ...validation.errors,
        ...excludedErrors,
        ...modeErrors,
        ...scaleErrors
      ];
      if (
        validation.ok &&
        excludedErrors.length === 0 &&
        modeErrors.length === 0 &&
        scaleErrors.length === 0
      ) {
        const normalized =
          adapter.normalizeInput(output) as RecipeInput;

        const finalized = useCookidooFidelityFixes
          ? applyCookidooSpeedRamps(normalized, page.markdown)
          : normalized;

        const finalValidation =
          adapter.validateInput(finalized);

        if (finalValidation.ok) {
          const payloadError = tryCreatePayload(adapter, finalized);
          if (!payloadError) return finalized;
          allErrors.push(payloadError);
          feedback = { errors: allErrors, previous: output };
          continue;
        }

        feedback = {
          errors: finalValidation.errors,
          previous: finalized
        };

        continue;
      }
        continue;
      }
      feedback = { errors: allErrors, previous: output };
    }

    throw new Error(`OpenAI output failed validation after ${finalOptions.maxCorrectionAttempts} correction attempts:\n${feedback?.errors.join("\n")}`);
  }

  private async generateOnce(
    page: RetrievedRecipePage,
    options: Required<RecipeGenerationOptions>,
    feedback?: { errors: string[]; previous: unknown }
  ): Promise<unknown> {
    const adapter = options.adapter;
    const schema = adapter.getSchema(options);
    const strictSchema = makeOpenAIStrictSchema(schema);
    const fullSchemaText = JSON.stringify(schema, null, 2);
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

    const detectedSource = detectRecipeSource(page.finalUrl || page.url);
    const sourcePolicy =
      detectedSource.type === "cookidoo-official"
        ? "machine-fidelity"
        : "adapt";

    const systemPromptText = adapter.getPromptInstructions(options.locale, {
      ...options,
      sourcePolicy
    });

    const userPromptText = [
      `Source URL: ${page.finalUrl || page.url}`,
      `Detected title: ${page.title}`,
      `Preferred locale: ${options.locale}`,
      "",
      "Full schema with detailed descriptions:",
      fullSchemaText,
      correctionText,
      "",
      "Recipe page as Markdown:",
      page.markdown
    ].filter(Boolean).join("\n");

    let content: string | undefined;

    if (this.client.chat?.completions?.create) {
      const response = await this.client.chat.completions.create({
        model: options.model,
        messages: [
          {
            role: "system",
            content: systemPromptText
          },
          {
            role: "user",
            content: userPromptText
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: adapter.id === "tm"
              ? "thermomix_cookidoo_recipe"
              : "monsieur_cuisine_smart_recipe",
            strict: true,
            schema: strictSchema
          }
        }
      });
      content = response.choices?.[0]?.message?.content ?? undefined;
    } else if ((this.client as unknown as { responses?: { create: (args: unknown) => Promise<{ output_text?: string }> } }).responses?.create) {
      const response = await (this.client as unknown as { responses: { create: (args: unknown) => Promise<{ output_text?: string }> } }).responses.create({
        model: options.model,
        reasoning: { effort: options.reasoningEffort },
        text: {
          format: {
            type: "json_schema",
            name: adapter.id === "tm" ? "thermomix_cookidoo_recipe" : "monsieur_cuisine_smart_recipe",
            strict: true,
            schema: strictSchema
          }
        },
        instructions: systemPromptText,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: userPromptText }]
          }
        ]
      });
      content = response.output_text;
    }

    if (!content) {
      throw new Error("LLM generator returned an empty response.");
    }

    return JSON.parse(content);
  }
}

/**
 * Checks that none of the recipe steps use a mode that was excluded for this generation run.
 * Returns an array of human-readable error strings suitable for feeding back to the LLM.
 */
function validateExcludedModes(output: unknown, excludeModes: string[] = []): string[] {
  const finalExcludeModes = excludeModes ?? [];
  if (!finalExcludeModes.length || typeof output !== "object" || !output) return [];
  const excluded = new Set(finalExcludeModes);
  const errors: string[] = [];

  // MC structure
  const mcSteps = getArray(getRecord(output, "servingSize"), "steps");
  mcSteps.forEach((step, index) => {
    const modeType = getString(getRecord(step, "mode"), "type");
    if (modeType && excluded.has(modeType)) {
      errors.push(`/servingSize/steps/${index}/mode/type must not be "${modeType}" — this mode requires an accessory the user does not own. Replace it with an alternative mode or type "none".`);
    }
  });

  // TM structure
  const tmSteps = getArray(output, "steps");
  tmSteps.forEach((step, index) => {
    const annotations = getArray(step, "modeAnnotations");
    annotations.forEach((ann, annIdx) => {
      const modeType = getString(getRecord(ann, "mode"), "type");
      if (modeType && excluded.has(modeType)) {
        errors.push(`/steps/${index}/modeAnnotations/${annIdx}/mode/type must not be "${modeType}" — this mode requires an accessory the user does not own. Replace it with an alternative mode.`);
      }
    });
  });

  return errors;
}

/**
 * Converts every Monsieur Cuisine step mode to its device form and reports the ones that are out of range
 * (time, temperature, speed...). Returns error strings that point at the failing step for LLM correction.
 */
function validateModeSettings(output: unknown): string[] {
  const steps = getArray(getRecord(output, "servingSize"), "steps");
  const errors: string[] = [];
  steps.forEach((step, index) => {
    const mode = getRecord(step, "mode");
    if (!mode) return;
    try {
      promptModeToRawMode(mode as unknown as PromptModeInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`/servingSize/steps/${index}/mode (step "${getString(step, "title") ?? ""}"): ${message} Change this step so it stays within the allowed range, e.g. split the work into several steps or use another mode.`);
    }
  });
  return errors;
}

function tryCreatePayload(adapter: NonNullable<RecipeGenerationOptions["adapter"]>, input: RecipeInput): string | undefined {
  try {
    adapter.createPayload(input as never);
    return undefined;
  } catch (error) {
    return `Recipe could not be converted for the device: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" ? value : "medium";
}
