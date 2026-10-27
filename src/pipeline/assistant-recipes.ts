import type { DeviceAdapter } from "../devices/adapter.js";
import type { DeviceId } from "../devices/api.js";
import { buildRecipeGenerationRequest } from "../llm/generation-request.js";
import { createLogger, type SmartRecipeLogger } from "../logging/logger.js";
import { CookieAuthProvider, type AuthProvider } from "../mc/auth.js";
import { retrieveRecipePage } from "../retriever/retriever.js";
import type { RetrievedRecipePage } from "../retriever/types.js";
import { detectRecipeSource, fetchRecipeSourceAsPage, type RecipeSource, type SourceCookies } from "../sources/index.js";
import { getArray, getNumber, getRecord, getString, isRecord } from "../utils/unknown.js";
import { NullImageProvider } from "./images.js";
import { checkRecipeInput } from "./recipe-checks.js";

// Workflow for recipes written by an external assistant (Claude, Gemini, a human):
// prepare a brief → the assistant writes the model-facing recipe input → check → upload.
// Nothing here calls an LLM.

export type SourceTypeHint = "web" | "mc" | "cookidoo" | "tm";

export interface SourceAccess {
  cookies?: SourceCookies;
  locale?: string;
}

export interface RetrieveRecipeSourceOptions {
  source?: SourceTypeHint;
  includeImageBytes: boolean;
  /** Credentials and locale for authenticated sources (Monsieur Cuisine, Cookidoo), chosen per detected source. */
  sourceAccess?: (source: RecipeSource) => SourceAccess;
}

export async function retrieveRecipeSource(url: string, options: RetrieveRecipeSourceOptions): Promise<RetrievedRecipePage> {
  const source = detectRecipeSource(url, { source: options.source });
  if (source.type === "web") {
    return await retrieveRecipePage(source.url, { includeImageBytes: options.includeImageBytes });
  }
  const access = options.sourceAccess?.(source) ?? {};
  return await fetchRecipeSourceAsPage(source, {
    cookies: access.cookies,
    locale: access.locale ?? ("locale" in source && source.locale ? source.locale : "de-DE"),
    includeImageBytes: options.includeImageBytes,
  });
}

/** Thermomix inputs have a numeric servingSize and top-level steps; Monsieur Cuisine nests both. */
export function detectRecipeDevice(input: unknown): DeviceId {
  return isRecord(input) && (typeof input.servingSize === "number" || Array.isArray(input.steps)) ? "tm" : "mc";
}

/** Wraps pasted recipe text (or nothing, for uploads without a source) as a page. */
export function textRecipePage(markdown: string, title: string): RetrievedRecipePage {
  return { url: "", finalUrl: "", title, markdown, html: "", images: [] };
}

export function isSourceTypeHint(value: unknown): value is SourceTypeHint {
  return value === "web" || value === "mc" || value === "cookidoo" || value === "tm";
}

/** Official Cookidoo recipes converted for Monsieur Cuisine get extra checks against the source text. */
export function sourceFidelityChecksApply(device: DeviceId, sourceUrl: string | undefined): boolean {
  return device === "mc" && Boolean(sourceUrl) && detectRecipeSource(sourceUrl ?? "").type === "cookidoo-official";
}

export interface ExcludedModeSettings {
  mcFoodProcessor: boolean;
  extendTmModes: boolean;
  extra?: readonly string[];
}

/** Modes the recipe must not use: accessories the user lacks, and TM modes My Creations cannot edit. */
export function defaultExcludedModes(device: DeviceId, settings: ExcludedModeSettings): string[] {
  const excluded = [...(settings.extra ?? [])];
  if (device === "mc" && !settings.mcFoodProcessor && !excluded.includes("foodProcessor")) excluded.push("foodProcessor");
  if (device === "tm" && !settings.extendTmModes && !excluded.includes("cook")) excluded.push("cook");
  return excluded;
}

export interface RecipeBrief {
  device: DeviceId;
  locale: string;
  excludeModes: string[];
  sourceUrl: string;
  title: string;
  imageCount: number;
  /** System-prompt style rules for writing the recipe. */
  instructions: string;
  /** The request: full schema, locale and the source recipe text. */
  task: string;
}

export function buildRecipeBrief(
  page: RetrievedRecipePage,
  adapter: DeviceAdapter,
  options: { locale: string; excludeModes: string[]; tmVersion?: string }
): RecipeBrief {
  const request = buildRecipeGenerationRequest(page, adapter, {
    locale: options.locale,
    excludeModes: options.excludeModes,
    ...(adapter.id === "tm" && options.tmVersion ? { tmVersion: options.tmVersion } : {})
  });
  return {
    device: adapter.id,
    locale: options.locale,
    excludeModes: options.excludeModes,
    sourceUrl: page.finalUrl || page.url,
    title: page.title,
    imageCount: page.images.length,
    instructions: request.systemPrompt,
    task: request.userPrompt
  };
}

/**
 * The only statuses SmartRecipe sends. private-publish (the default) puts the recipe straight into the user's own
 * library and onto the cooker; draft is a web-only draft and only used when explicitly requested. Community
 * submission (public, sent to Monsieur Cuisine for review) is never used.
 */
export const RECIPE_STATUSES = ["private-publish", "draft"] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

export function isRecipeStatus(value: unknown): value is RecipeStatus {
  return RECIPE_STATUSES.some((status) => status === value);
}

/** Monsieur Cuisine recipes default to private-publish so they appear on the cooker; Cookidoo has no such status. */
export function defaultRecipeStatus(device: DeviceId, requested?: string): RecipeStatus {
  if (requested === undefined || requested === "") return device === "mc" ? "private-publish" : "draft";
  if (!isRecipeStatus(requested)) {
    throw new TypeError(`Unsupported recipe status '${requested}'. Use private-publish (default: private, straight to your cooker) or draft; community submission is not supported.`);
  }
  return requested;
}

export function cookieAuthProvider(device: DeviceId, cookie: string): AuthProvider {
  if (device === "tm") {
    return {
      async getSession() {
        return { cookie, source: "cookie" };
      }
    };
  }
  return new CookieAuthProvider(cookie);
}

export interface UploadRecipeInputOptions {
  adapter: DeviceAdapter;
  recipeInput: unknown;
  locale: string;
  /** Source page for the recipe image and source-fidelity checks; use textRecipePage("", title) when there is none. */
  page: RetrievedRecipePage;
  excludeModes?: readonly string[];
  status?: string;
  /** "source" uploads the best image from the page (if any); "none" uploads without an image. */
  image?: "source" | "none";
  cookie?: string;
  authProvider?: AuthProvider;
  logger?: SmartRecipeLogger;
}

export interface UploadedRecipe {
  recipeInput: unknown;
  payload: unknown;
  draft?: unknown;
  recipeUrl?: string;
  uploadedImage?: unknown;
  recipeImage?: unknown;
}

export type UploadRecipeInputOutcome =
  | { kind: "invalid"; errors: string[] }
  | { kind: "uploaded"; recipe: UploadedRecipe };

/** Checks the recipe exactly like generated output, then uploads it. Invalid recipes are never sent. */
export async function uploadRecipeInput(options: UploadRecipeInputOptions): Promise<UploadRecipeInputOutcome> {
  const { adapter, page } = options;
  const sourceUrl = page.finalUrl || page.url;
  const check = checkRecipeInput(adapter, options.recipeInput, {
    excludeModes: options.excludeModes,
    sourceUrl: sourceUrl || undefined,
    sourceMarkdown: page.markdown
  });
  if (check.kind === "invalid") return { kind: "invalid", errors: check.errors };
  if (options.status !== undefined && options.status !== "" && !isRecipeStatus(options.status)) {
    return { kind: "invalid", errors: [`status must be "private-publish" (default) or "draft", not "${options.status}".`] };
  }

  const recipeInput = isRecord(check.recipeInput)
    ? { ...check.recipeInput, status: defaultRecipeStatus(adapter.id, options.status) }
    : check.recipeInput;
  const result = await adapter.upload({
    payload: adapter.createPayload(recipeInput),
    recipeInput,
    page,
    locale: options.locale,
    cookie: options.cookie ?? "",
    logger: options.logger ?? createLogger(),
    imageProvider: options.image === "none" ? new NullImageProvider() : undefined,
    authProvider: options.authProvider ?? (options.cookie ? cookieAuthProvider(adapter.id, options.cookie) : undefined)
  });

  return {
    kind: "uploaded",
    recipe: {
      recipeInput,
      payload: result.payload,
      draft: result.draft,
      recipeUrl: result.recipeUrl,
      uploadedImage: result.uploadedImage,
      recipeImage: result.recipeImage
    }
  };
}

export interface UploadedRecipeSummary {
  id?: string;
  title?: string;
  status?: string;
  recipeUrl?: string;
  imageSource?: string;
  /** Why Monsieur Cuisine refused to publish privately (the recipe then stays a draft). */
  publishError?: string;
}

export function summarizeUploadedRecipe(recipe: UploadedRecipe): UploadedRecipeSummary {
  const rawId = isRecord(recipe.draft) ? recipe.draft.id : undefined;
  return {
    id: rawId === undefined || rawId === null ? undefined : String(rawId),
    title: getString(recipe.draft, "title") ?? getString(recipe.recipeInput, "title"),
    status: getString(recipe.draft, "status") ?? getString(recipe.recipeInput, "status"),
    recipeUrl: recipe.recipeUrl,
    imageSource: getString(recipe.recipeImage, "source"),
    publishError: getString(recipe.draft, "publishError")
  };
}

export interface RecipeListEntry {
  id?: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  deviceTypes: string[];
  ingredientCount?: number;
  stepCount?: number;
  hasImage: boolean;
  hasHints: boolean;
  recipeUrl?: string;
  thumbnailUrl?: string;
}

export interface RecipeList {
  total: number;
  totalPage: number;
  recipes: RecipeListEntry[];
}

/** Normalizes a device's recipe/draft listing response, optionally filtered by title or ID. */
export function summarizeRecipeList(result: unknown, options: { search?: string } = {}): RecipeList {
  const data = getRecord(result, "data");
  let recipes = getArray(data, "recipes");
  const total = getNumber(data, "total") ?? recipes.length;
  const totalPage = getNumber(data, "totalPage") ?? 1;

  if (options.search) {
    const query = options.search.toLowerCase();
    recipes = recipes.filter((recipe) =>
      String(getString(recipe, "title") ?? "").toLowerCase().includes(query) ||
      String(getString(recipe, "id") ?? "").toLowerCase().includes(query)
    );
  }

  return {
    total,
    totalPage,
    recipes: recipes.map((recipe) => {
      const rawId = isRecord(recipe) ? (recipe.id ?? recipe.recipeId) : undefined;
      return {
        id: rawId !== undefined && rawId !== null ? String(rawId) : undefined,
        title: getString(recipe, "title"),
        status: getString(recipe, "status"),
        updatedAt: getString(recipe, "updatedAt"),
        deviceTypes: getArray(recipe, "deviceTypes").map((deviceType) => {
          if (typeof deviceType === "string") return deviceType;
          if (isRecord(deviceType) && typeof deviceType.name === "string") return deviceType.name;
          return String(deviceType);
        }),
        ingredientCount: getNumber(recipe, "ingredientCount"),
        stepCount: getNumber(recipe, "stepCount"),
        hasImage: Boolean(isRecord(recipe) ? recipe.hasImage : false),
        hasHints: Boolean(isRecord(recipe) ? recipe.hasHints : false),
        recipeUrl: getString(recipe, "recipeUrl"),
        thumbnailUrl: getString(recipe, "thumbnailUrl")
      };
    })
  };
}
