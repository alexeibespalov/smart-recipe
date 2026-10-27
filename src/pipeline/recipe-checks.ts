import type { DeviceAdapter } from "../devices/adapter.js";
import type { RecipeInput } from "../recipes/schema.js";
import type { PromptModeInput } from "../recipes/types.js";
import { applyCookidooSpeedRamps } from "../recipes/cookidoo-speed-ramp.js";
import { validateCookidooScaleSteps } from "../recipes/cookidoo-scale-fidelity.js";
import { promptModeToRawMode } from "../recipes/modes.js";
import { detectRecipeSource } from "../sources/index.js";
import { getArray, getRecord, getString } from "../utils/unknown.js";

export interface RecipeCheckOptions {
  /** Mode types the recipe must not use (e.g. accessories the user does not own). */
  excludeModes?: readonly string[];
  /** Original recipe URL; official Cookidoo sources get extra fidelity checks for Monsieur Cuisine. */
  sourceUrl?: string;
  /** Source recipe Markdown, needed for the Cookidoo fidelity checks. */
  sourceMarkdown?: string;
}

export type RecipeCheckResult =
  | { kind: "ok"; recipeInput: unknown }
  | {
    kind: "invalid";
    errors: string[];
    /** The JSON the errors refer to, for feeding back to whoever wrote it. */
    checked: unknown;
  };

/**
 * Validates, normalizes and finalizes a model-facing recipe input, regardless of who wrote it
 * (the built-in generator or an external assistant). Errors point at the failing field so they can be fixed.
 */
export function checkRecipeInput(
  adapter: DeviceAdapter,
  output: unknown,
  options: RecipeCheckOptions = {}
): RecipeCheckResult {
  const useCookidooFidelityFixes =
    adapter.id === "mc" &&
    Boolean(options.sourceUrl) &&
    detectRecipeSource(options.sourceUrl ?? "").type === "cookidoo-official";

  const validation = adapter.validateInput(output);
  const excludedErrors = validateExcludedModes(output, options.excludeModes);
  const modeErrors = validation.ok ? validateModeSettings(output) : [];
  const scaleErrors = useCookidooFidelityFixes
    ? validateCookidooScaleSteps(output, options.sourceMarkdown ?? "")
    : [];
  // Union schemas repeat the same message once per branch; keep each one once.
  const errors = [...new Set([...validation.errors, ...excludedErrors, ...modeErrors, ...scaleErrors])];
  if (errors.length > 0) return { kind: "invalid", errors, checked: output };

  const normalized = adapter.normalizeInput(output) as RecipeInput;
  const finalized = useCookidooFidelityFixes
    ? applyCookidooSpeedRamps(normalized, options.sourceMarkdown ?? "")
    : normalized;

  const finalValidation = adapter.validateInput(finalized);
  if (!finalValidation.ok) return { kind: "invalid", errors: [...new Set(finalValidation.errors)], checked: finalized };

  const payloadError = tryCreatePayload(adapter, finalized);
  if (payloadError) return { kind: "invalid", errors: [payloadError], checked: output };

  return { kind: "ok", recipeInput: finalized };
}

/**
 * Checks that none of the recipe steps use an excluded mode.
 * Returns an array of human-readable error strings suitable for feeding back to the recipe author.
 */
function validateExcludedModes(output: unknown, excludeModes: readonly string[] = []): string[] {
  if (!excludeModes.length || typeof output !== "object" || !output) return [];
  const excluded = new Set(excludeModes);
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
 * (time, temperature, speed...). Returns error strings that point at the failing step.
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

function tryCreatePayload(adapter: DeviceAdapter, input: RecipeInput): string | undefined {
  try {
    adapter.createPayload(input);
    return undefined;
  } catch (error) {
    return `Recipe could not be converted for the device: ${error instanceof Error ? error.message : String(error)}`;
  }
}
