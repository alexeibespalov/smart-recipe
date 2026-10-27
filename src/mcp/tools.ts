import process from "node:process";
import { randomUUID } from "node:crypto";
import { normalizeSupportedLocale } from "../catalogs/index.js";
import type { SupportedLocale } from "../catalogs/types.js";
import {
  browserSandboxFromEnv,
  getTargetDevice,
  getTmCookie,
  getTmVersion,
  loadDotEnv,
  mcHasFoodProcessor,
  upsertDotEnvValue
} from "../config/env.js";
import type { DeviceAdapter } from "../devices/adapter.js";
import { getDeviceAdapter } from "../devices/index.js";
import { CookidooError } from "../devices/tm/errors.js";
import type { SmartRecipeLogger } from "../logging/logger.js";
import { MonsieurCuisineApiError } from "../mc/errors.js";
import { checkRecipeInput } from "../pipeline/recipe-checks.js";
import {
  buildRecipeBrief,
  defaultExcludedModes,
  defaultRecipeStatus,
  detectRecipeDevice,
  isRecipeStatus,
  retrieveRecipeSource,
  sourceFidelityChecksApply,
  summarizeRecipeList,
  summarizeUploadedRecipe,
  textRecipePage,
  uploadRecipeInput
} from "../pipeline/assistant-recipes.js";
import type { DeviceId } from "../devices/api.js";
import type { RetrievedRecipePage } from "../retriever/types.js";
import { getNumber, getRecord, getString, isRecord } from "../utils/unknown.js";
import {
  AFTER_INVALID,
  AFTER_PREPARE,
  AFTER_VALID,
  LIST_PRESENTATION,
  LOGIN_STARTED,
  NOT_CONNECTED_HINT,
  SERVER_INSTRUCTIONS,
  presentationGuide,
  uploadConfirmation
} from "./presentation.js";
import { buildRecipeCard, titleEmoji } from "../recipes/recipe-card.js";
import type { McpServerDefinition, McpToolDefinition, McpToolResult } from "./protocol.js";

// Tools for an assistant that writes recipes itself. None of them call an LLM:
// prepare_recipe → (assistant writes JSON) → validate_recipe → upload_recipe.

/** Settings Claude Desktop passes from the extension's settings form; they win over ~/.smart-recipe. */
export const DESKTOP_SETTING_KEYS = [
  "TARGET_DEVICE",
  "MC_LOCALE",
  "TM_LOCALE",
  "TM_VERSION",
  "MC_HAS_FOOD_PROCESSOR",
  "SMART_RECIPE_BROWSER_CHANNEL",
  "SMART_RECIPE_BROWSER_PATH"
] as const;

export interface SmartCookerToolsOptions {
  /** Shared SmartRecipe config file (saved sessions and settings), normally ~/.smart-recipe. */
  configPath: string;
  logger: SmartRecipeLogger;
  /** How long a call waits before reporting a job as still running. */
  waitMs?: number;
  /** Desktop-provided settings; defaults to the non-empty DESKTOP_SETTING_KEYS from the environment at startup. */
  pinnedSettings?: Record<string, string>;
  /** Reported to clients as serverInfo.version; the extension build injects its manifest version. */
  version?: string;
  /** The recipe-card MCP Apps view (single-file HTML); a placeholder is served when it returns nothing. */
  cardHtml?: () => string | undefined;
}

/** The MCP Apps view that shows upload and list results as recipe cards. */
export const CARD_RESOURCE_URI = "ui://smart-cooker/card.html";
const CARD_IMAGE_DOMAINS = ["https://mc-web-user-content-cdn.tecpal.com", "https://mc-web-content-cdn.tecpal.com"];
const CARD_PLACEHOLDER = "<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:sans-serif\">Smart Cooker card view is not built.</body>";

type JobOutput = { result: unknown; isError?: boolean; view?: Record<string, unknown> };

type JobKind = "prepare" | "validate" | "upload" | "list" | "check" | "login";

interface Job {
  id: string;
  kind: JobKind;
  startedAt: number;
  done: Promise<void>;
  state:
    | { kind: "running" }
    | { kind: "done"; result: unknown; isError: boolean; view?: Record<string, unknown> }
    | { kind: "failed"; error: string };
}

class ToolInputError extends Error {}

/** Settings chosen in Claude Desktop's extension form. */
export function pinnedSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  // Blank or unsubstituted ("${user_config.x}") values mean the user did not set it.
  const usable = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed && !trimmed.startsWith("${") ? trimmed : undefined;
  };
  const pinned: Record<string, string> = {};
  for (const key of DESKTOP_SETTING_KEYS) {
    const value = usable(env[key]);
    if (value) pinned[key] = value;
  }
  return pinned;
}

export function createSmartCookerServer(options: SmartCookerToolsOptions): McpServerDefinition {
  const waitMs = options.waitMs ?? 50_000;
  const pinned = options.pinnedSettings ?? pinnedSettingsFromEnv();
  const jobs = new Map<string, Job>();
  const logger = options.logger;

  /** Picks up sessions saved by other processes (CLI logins), then re-applies the Desktop settings. */
  function refreshSettings(): void {
    loadDotEnv(options.configPath, { override: true });
    for (const [key, value] of Object.entries(pinned)) process.env[key] = value;
  }

  function startJob(kind: JobKind, run: () => Promise<JobOutput>): Job {
    const job: Job = { id: randomUUID().slice(0, 8), kind, startedAt: Date.now(), done: Promise.resolve(), state: { kind: "running" } };
    job.done = run().then(
      ({ result, isError, view }) => { job.state = { kind: "done", result, isError: Boolean(isError), view }; },
      (error: unknown) => {
        logger.warn({ err: error, kind }, "smart-cooker tool failed");
        job.state = { kind: "failed", error: describeError(error) };
      }
    );
    jobs.set(job.id, job);
    return job;
  }

  async function waitFor(job: Job, ms: number): Promise<McpToolResult> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([job.done, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
    clearTimeout(timer);
    return report(job);
  }

  function report(job: Job): McpToolResult {
    const base = { job_id: job.id, kind: job.kind };
    switch (job.state.kind) {
      case "running":
        return text({
          status: "running",
          ...base,
          elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
          next: job.kind === "login"
            ? LOGIN_STARTED
            : "Still working. Call job_status with this job_id to wait for the result."
        });
      case "done": {
        const reply = text({ status: job.state.isError ? "failed" : "done", ...base, result: job.state.result }, job.state.isError);
        return job.state.view ? { ...reply, structuredContent: job.state.view } : reply;
      }
      case "failed":
        return text({ status: "failed", ...base, error: job.state.error }, true);
      default: {
        const unreachable: never = job.state;
        return unreachable;
      }
    }
  }

  async function prepare(args: Record<string, unknown>) {
    const device = deviceArg(args);
    const adapter = getDeviceAdapter(device);
    const locale = localeArg(device, args.locale);
    const page = await sourcePage(args);
    if (typeof args.tm_version === "string") process.env.TM_VERSION = args.tm_version;
    const brief = buildRecipeBrief(page, adapter, {
      locale,
      excludeModes: excludedModes(device),
      tmVersion: getTmVersion()
    });
    return { result: { ...brief, presentation: presentationGuide(device), next: AFTER_PREPARE } };
  }

  async function validate(args: Record<string, unknown>) {
    const recipe = recipeArg(args);
    const device = deviceArg(args, recipe);
    const adapter = getDeviceAdapter(device);
    const sourceUrl = stringArg(args.source_url);
    const page = sourceUrl && sourceFidelityChecksApply(device, sourceUrl)
      ? await retrieveRecipeSource(sourceUrl, { includeImageBytes: false, sourceAccess })
      : undefined;
    const check = checkRecipeInput(adapter, recipe, { excludeModes: excludedModes(device), sourceUrl, sourceMarkdown: page?.markdown });
    return {
      result: check.kind === "ok"
        ? { ok: true, errors: [], next: AFTER_VALID }
        : { ok: false, errors: check.errors, next: AFTER_INVALID }
    };
  }

  async function upload(args: Record<string, unknown>): Promise<JobOutput> {
    const recipe = recipeArg(args);
    const device = deviceArg(args, recipe);
    const adapter = getDeviceAdapter(device);
    const locale = localeArg(device, args.locale ?? (isRecord(recipe) && isRecord(recipe.settings) ? recipe.settings.locale : undefined));
    const sourceUrl = stringArg(args.source_url);
    const withImage = args.no_image !== true;
    const page = sourceUrl
      ? await retrieveRecipeSource(sourceUrl, { includeImageBytes: withImage, sourceAccess })
      : textRecipePage("", getString(recipe, "title") ?? "");
    const excludeModes = excludedModes(device);

    // Check first so an invalid recipe never turns into a "not connected" error.
    const check = checkRecipeInput(adapter, recipe, { excludeModes, sourceUrl, sourceMarkdown: page.markdown });
    if (check.kind === "invalid") {
      return { result: { ok: false, errors: check.errors, next: AFTER_INVALID }, isError: true, view: { kind: "invalid", errors: check.errors } };
    }
    const requestedStatus = stringArg(args.status);
    if (requestedStatus !== undefined && !isRecipeStatus(requestedStatus)) {
      throw new ToolInputError(`'status' must be omitted (private, the default) or 'draft'. Recipes are never submitted to the community.`);
    }

    const cookie = requireCookie(adapter);
    const outcome = await uploadRecipeInput({
      adapter,
      recipeInput: recipe,
      locale,
      page,
      excludeModes,
      status: requestedStatus,
      image: withImage ? "source" : "none",
      cookie,
      logger
    });
    if (outcome.kind === "invalid") {
      return { result: { ok: false, errors: outcome.errors, next: AFTER_INVALID }, isError: true, view: { kind: "invalid", errors: outcome.errors } };
    }
    const summary = summarizeUploadedRecipe(outcome.recipe);
    const expectedStatus = defaultRecipeStatus(device, requestedStatus);
    const statusMismatch = device === "mc" && summary.status !== undefined && summary.status !== expectedStatus;
    const warning = statusMismatch
      ? `Monsieur Cuisine kept this recipe as '${summary.status}' instead of publishing it privately${summary.publishError ? `: ${summary.publishError}` : ""}. Tell the user in one sentence and give them the web link, where they can fix it and press the private-publish button. Do not upload it again (that would create a duplicate).`
      : undefined;
    return {
      result: { ...summary, tellUser: uploadConfirmation(device, summary), ...(warning ? { warning } : {}) },
      view: {
        kind: "upload",
        card: buildRecipeCard(outcome.recipe.recipeInput, device),
        upload: {
          status: summary.status,
          recipeUrl: summary.recipeUrl,
          published: !statusMismatch,
          publishError: summary.publishError,
          thumbnailUrl: summary.id ? await thumbnailFor(adapter, cookie, summary.id) : undefined
        }
      }
    };
  }

  /** Best effort: the uploaded image's URL (it may still be processing, then there is none yet). */
  async function thumbnailFor(adapter: DeviceAdapter, cookie: string, id: string): Promise<string | undefined> {
    try {
      const stored = await adapter.getRecipe({ cookie, id });
      const data = getRecord(stored, "data");
      const recipe = getRecord(data, "recipe") ?? data;
      const thumbnail = getRecord(recipe, "thumbnail");
      return getString(getRecord(thumbnail, "landscapeMedia"), "url") ?? getString(getRecord(thumbnail, "portraitMedia"), "url");
    } catch (error) {
      logger.debug({ err: error, id }, "no thumbnail for the uploaded recipe yet");
      return undefined;
    }
  }

  async function list(args: Record<string, unknown>): Promise<JobOutput> {
    const adapter = getDeviceAdapter(deviceArg(args));
    const limit = getNumber(args, "limit");
    const result = await adapter.listDrafts({ cookie: requireCookie(adapter), size: limit && limit > 0 ? Math.floor(limit) : 20 });
    const list = summarizeRecipeList(result, { search: stringArg(args.search) });
    return {
      result: { ...list, presentation: LIST_PRESENTATION },
      view: {
        kind: "list",
        device: adapter.id,
        total: list.total,
        search: stringArg(args.search),
        recipes: list.recipes.map((recipe) => ({ ...recipe, emoji: titleEmoji(recipe.title ?? "") }))
      }
    };
  }

  async function check(args: Record<string, unknown>) {
    const device = deviceArg(args);
    const adapter = getDeviceAdapter(device);
    const settings = {
      device,
      deviceName: adapter.deviceName,
      locale: localeArg(device, undefined),
      ...(device === "mc" ? { foodProcessor: mcHasFoodProcessor() } : { tmVersion: getTmVersion() })
    };
    const cookie = cookieFor(device);
    if (!cookie) return { result: { ...settings, connected: false, message: "No saved session.", next: NOT_CONNECTED_HINT } };
    try {
      const user = await adapter.getCurrentUser(cookie);
      return { result: { ...settings, connected: true, userId: isRecord(user) ? user.id : undefined } };
    } catch (error) {
      return { result: { ...settings, connected: false, message: describeError(error), next: NOT_CONNECTED_HINT } };
    }
  }

  async function login(args: Record<string, unknown>) {
    const device = deviceArg(args);
    const adapter = getDeviceAdapter(device);
    const session = await adapter.browserLogin({
      locale: localeArg(device, undefined),
      installBrowsers: true,
      browserChannel: process.env.SMART_RECIPE_BROWSER_CHANNEL || undefined,
      browserPath: process.env.SMART_RECIPE_BROWSER_PATH || undefined,
      browserSandbox: browserSandboxFromEnv(),
      onStatus: (message) => logger.info({ device }, message)
    });
    // The cookie is saved for later calls but never returned into the conversation.
    upsertDotEnvValue(options.configPath, device === "tm" ? "TM_COOKIE" : "MC_COOKIE", session.cookie);
    return { result: { connected: true, deviceName: adapter.deviceName, message: "Login saved. Run check_connection to confirm." } };
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    refreshSettings();
    try {
      switch (name) {
        case "prepare_recipe":
          return await waitFor(startJob("prepare", () => prepare(args)), waitMs);
        case "validate_recipe":
          return await waitFor(startJob("validate", () => validate(args)), waitMs);
        case "upload_recipe":
          return await waitFor(startJob("upload", () => upload(args)), waitMs);
        case "list_recipes":
          return await waitFor(startJob("list", () => list(args)), waitMs);
        case "check_connection":
          return await waitFor(startJob("check", () => check(args)), waitMs);
        case "connect_account":
          // Returns quickly: the user needs minutes to log in, finished via job_status.
          return await waitFor(startJob("login", () => login(args)), 4_000);
        case "job_status": {
          const job = jobs.get(String(args.job_id ?? ""));
          if (!job) throw new ToolInputError(`Unknown job_id '${String(args.job_id)}'. Jobs are lost when Claude Desktop restarts.`);
          return await waitFor(job, job.kind === "login" ? 15_000 : waitMs);
        }
        default:
          throw new ToolInputError(`Unknown tool '${name}'.`);
      }
    } catch (error) {
      return { content: [{ type: "text", text: describeError(error) }], isError: true };
    }
  }

  return {
    serverInfo: { name: "smart-cooker", version: options.version ?? "dev" },
    instructions: SERVER_INSTRUCTIONS,
    tools: SMART_COOKER_TOOLS,
    resources: [
      {
        uri: CARD_RESOURCE_URI,
        name: "Smart Cooker recipe card",
        description: "Shows uploaded recipes and the user's cooker recipes as colourful cards.",
        mimeType: "text/html;profile=mcp-app",
        _meta: { ui: { csp: { resourceDomains: CARD_IMAGE_DOMAINS }, prefersBorder: true } },
        read: () => options.cardHtml?.() ?? CARD_PLACEHOLDER
      }
    ],
    callTool
  };
}

// ─── Argument helpers ─────────────────────────────────────────────────────────

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function deviceArg(args: Record<string, unknown>, recipe?: unknown): DeviceId {
  if (args.device === "mc" || args.device === "tm") return args.device;
  if (args.device !== undefined) throw new ToolInputError("'device' must be 'mc' or 'tm'.");
  return recipe === undefined ? getTargetDevice() : detectRecipeDevice(recipe);
}

function localeArg(device: DeviceId, requested: unknown): SupportedLocale {
  const raw = requested ?? (device === "tm" ? process.env.TM_LOCALE : process.env.MC_LOCALE);
  const locale = normalizeSupportedLocale(raw);
  if (raw !== undefined && raw !== "" && !locale) {
    throw new ToolInputError(`Unsupported locale '${String(raw)}'. Use de-DE, en-US, fr-FR, it-IT, pl-PL or cs-CZ.`);
  }
  return locale ?? "de-DE";
}

function recipeArg(args: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(args.recipe)) throw new ToolInputError("'recipe' must be the recipe JSON object.");
  return args.recipe;
}

function excludedModes(device: DeviceId): string[] {
  return defaultExcludedModes(device, { mcFoodProcessor: mcHasFoodProcessor(), extendTmModes: false });
}

function cookieFor(device: DeviceId): string | undefined {
  return (device === "tm" ? getTmCookie() : process.env.MC_COOKIE) || undefined;
}

function requireCookie(adapter: DeviceAdapter): string {
  const cookie = cookieFor(adapter.id);
  if (!cookie) throw new ToolInputError(`Not connected to ${adapter.deviceName}. Call connect_account first.`);
  return cookie;
}

function sourceAccess() {
  return { cookies: { mc: process.env.MC_COOKIE || undefined, tm: getTmCookie() || undefined } };
}

async function sourcePage(args: Record<string, unknown>): Promise<RetrievedRecipePage> {
  const url = stringArg(args.url);
  const recipeText = typeof args.text === "string" && args.text.trim() !== "" ? args.text : undefined;
  if (Boolean(url) === Boolean(recipeText)) throw new ToolInputError("Provide exactly one of 'url' or 'text'.");
  if (url) return await retrieveRecipeSource(url, { includeImageBytes: false, sourceAccess });
  return textRecipePage(recipeText ?? "", stringArg(args.title) ?? "");
}

function describeError(error: unknown): string {
  const status =
    error instanceof MonsieurCuisineApiError || error instanceof CookidooError ? error.status : undefined;
  if (status === 401 || status === 403 || (error instanceof MonsieurCuisineApiError && error.code === 110002)) {
    return "The cooker session is missing or expired. Call connect_account to log in again.";
  }
  return error instanceof Error ? error.message : String(error);
}

function text(body: unknown, isError = false): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], ...(isError ? { isError: true } : {}) };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const deviceProp = {
  type: "string",
  enum: ["mc", "tm"],
  description: "mc = Monsieur Cuisine Smart, tm = Thermomix (Cookidoo). Omit to use the user's default cooker."
};
const localeProp = {
  type: "string",
  description: "Recipe language: de-DE, en-US, fr-FR, it-IT, pl-PL or cs-CZ (two-letter codes like 'fr' work). Omit to use the default."
};
const recipeProp = {
  type: "object",
  description: "The recipe JSON you wrote, following the instructions and schema from prepare_recipe."
};
const sourceUrlProp = {
  type: "string",
  description: "The original recipe URL, if the recipe came from a link (adds the source photo and source-fidelity checks)."
};

export const SMART_COOKER_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "prepare_recipe",
    title: "Prepare recipe brief",
    description:
      "Use whenever the user shares a recipe link or recipe text and wants it on their Monsieur Cuisine Smart (Lidl) or Thermomix (Cookidoo) — e.g. \"put this on my cooker\" — even if they don't name this tool. Step 1 of 3: fetches the recipe and returns everything YOU need to write the cooker recipe yourself: device rules, the exact JSON schema (categories, complexity IDs, mode limits), the source text and how to present the result. No AI runs here — you write the JSON, then call validate_recipe. Pick device tm if they mention Thermomix/Cookidoo, mc for Monsieur Cuisine/Lidl, otherwise omit it; pass locale only if they ask for a language.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Recipe page URL (any website, Cookidoo, or Monsieur Cuisine link). Provide url OR text." },
        text: { type: "string", description: "Raw recipe text (ingredients + method) pasted by the user. Provide url OR text." },
        title: { type: "string", description: "Optional title hint when importing from text." },
        device: deviceProp,
        locale: localeProp,
        tm_version: { type: "string", enum: ["tm7", "tm6", "tm5"], description: "Thermomix model; only for device tm." }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "validate_recipe",
    title: "Validate recipe JSON",
    description:
      "Step 2 of 3. Check recipe JSON you wrote against the device schema and physical limits. Returns { ok, errors, next }; each error names the failing field (e.g. /servingSize/steps/6/mode/speed must be <= 3). Fix and re-validate until ok is true, then follow `next`.",
    inputSchema: {
      type: "object",
      properties: { recipe: recipeProp, device: deviceProp, source_url: sourceUrlProp },
      required: ["recipe"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "upload_recipe",
    title: "Send recipe to cooker",
    description:
      "Step 3 of 3. Upload validated recipe JSON to the user's cooker account — only after showing the recipe and either the user clearly asked to send it or confirmed \"Send it?\". Leave status out: Monsieur Cuisine recipes are then private ('private-publish': straight into the user's own recipes and onto the cooker, no review). Pass status 'draft' only if the user explicitly asks for a web-only draft. Recipes are never submitted to the community. Thermomix uploads go to Cookidoo Created Recipes. Re-runs the same checks and refuses invalid recipes. On success, tell the user the returned `tellUser` text; never claim a recipe is on the cooker without it.",
    inputSchema: {
      type: "object",
      properties: {
        recipe: recipeProp,
        device: deviceProp,
        locale: localeProp,
        source_url: sourceUrlProp,
        status: {
          type: "string",
          enum: ["private-publish", "draft"],
          description: "Monsieur Cuisine only. Omit for private (default; straight to the user's cooker). 'draft' only when the user explicitly asks for a web-only draft."
        },
        no_image: { type: "boolean", description: "Upload without a recipe image. Default: the best image from source_url, if any." }
      },
      required: ["recipe"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: CARD_RESOURCE_URI } }
  },
  {
    name: "list_recipes",
    title: "List cooker recipes",
    description: "Use when the user asks what recipes or drafts are on their cooker. Lists the recipes in their account with status (private-publish = on cooker screen, draft = web only), step counts and links; the result says how to present them.",
    inputSchema: {
      type: "object",
      properties: {
        device: deviceProp,
        search: { type: "string", description: "Filter by title or ID." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "How many recipes to fetch (default 20)." }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: CARD_RESOURCE_URI } }
  },
  {
    name: "check_connection",
    title: "Check cooker connection",
    description: "Check whether the cooker account session is valid, and show the active cooker settings (default cooker, language, food-processor attachment, Thermomix model — changed in the extension's settings). Use after login or when a tool reports a missing or expired session.",
    inputSchema: { type: "object", properties: { device: deviceProp }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "connect_account",
    title: "Connect cooker account",
    description:
      "Use when the user wants to log in / connect their cooker account, or when a tool says the session is missing or expired. Opens the official Monsieur Cuisine or Cookidoo login page in a browser window on the user's computer; the session is saved locally and never shown in the conversation. Returns immediately with a job_id and what to tell the user.",
    inputSchema: { type: "object", properties: { device: deviceProp }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "job_status",
    title: "Get job result",
    description: "Wait for and return the result of a job that a previous tool reported as 'running'.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  }
];
