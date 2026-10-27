import OpenAI from "openai";
import type { RetrievedRecipePage } from "../retriever/types.js";
import type { RecipeInput } from "../recipes/schema.js";
import type { RecipeGenerationOptions, RecipeGenerator } from "./types.js";
import { makeOpenAIStrictSchema } from "./schema-format.js";
import { checkRecipeInput } from "../pipeline/recipe-checks.js";
import { buildRecipeGenerationRequest, type RecipeGenerationFeedback } from "./generation-request.js";
import type { ReasoningEffort } from "./types.js";

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
      model: options.model ?? process.env.GEMINI_MODEL ?? process.env.OPENAI_MODEL ?? (geminiKey ? "gemini-3.8-flash" : "gpt-4o-mini"),
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
    let feedback: RecipeGenerationFeedback | undefined;

    const adapter = finalOptions.adapter;

    for (let attempt = 0; attempt <= finalOptions.maxCorrectionAttempts; attempt += 1) {
      const output = await this.generateOnce(page, finalOptions, feedback);
      const check = checkRecipeInput(adapter, output, {
        excludeModes: finalOptions.excludeModes,
        sourceUrl: page.finalUrl || page.url,
        sourceMarkdown: page.markdown
      });
      if (check.kind === "ok") return check.recipeInput as RecipeInput;
      feedback = { errors: check.errors, previous: check.checked };
    }

    throw new Error(`OpenAI output failed validation after ${finalOptions.maxCorrectionAttempts} correction attempts:\n${feedback?.errors.join("\n")}`);
  }

  private async generateOnce(
    page: RetrievedRecipePage,
    options: Required<RecipeGenerationOptions>,
    feedback?: RecipeGenerationFeedback
  ): Promise<unknown> {
    const adapter = options.adapter;
    const request = buildRecipeGenerationRequest(page, adapter, options, feedback);
    const strictSchema = makeOpenAIStrictSchema(request.schema);
    const systemPromptText = request.systemPrompt;
    const userPromptText = request.userPrompt;

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

function parseReasoningEffort(value: string | undefined): ReasoningEffort {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" ? value : "medium";
}
