import { afterEach, describe, expect, it, vi } from "vitest";
import { MonsieurCuisineAdapter } from "../src/devices/mc/adapter.js";
import { createLogger } from "../src/logging/logger.js";
import { textRecipePage } from "../src/pipeline/assistant-recipes.js";
import { NullImageProvider } from "../src/pipeline/images.js";
import { createSmartRecipePayload } from "../src/recipes/payload.js";
import type { RecipeInput } from "../src/recipes/schema.js";
import { validSoup } from "./fixtures/mc-recipes.js";

interface ProxyCall {
  endpoint: string;
  method: string;
  payload?: Record<string, unknown>;
}

/** Fakes the Monsieur Cuisine proxy: create returns a draft (as the real API does), PATCH answers with `patchBody`. */
function stubProxy(patchResponse: { status: number; body: unknown }): ProxyCall[] {
  const calls: ProxyCall[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const call = JSON.parse(init.body) as ProxyCall;
    calls.push(call);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (call.method === "POST") {
      return json(200, { code: 0, message: "", data: { recipe: { id: 42, title: "Silky Tomato Soup", status: "draft" } } });
    }
    return json(patchResponse.status, patchResponse.body);
  });
  return calls;
}

async function uploadSoup(status: "private-publish" | "draft") {
  const adapter = new MonsieurCuisineAdapter();
  const recipeInput = { ...(validSoup as RecipeInput), status };
  return await adapter.upload({
    payload: adapter.createPayload(recipeInput),
    recipeInput,
    page: textRecipePage("", recipeInput.title),
    locale: "en-US",
    cookie: "session=test",
    logger: createLogger(),
    imageProvider: new NullImageProvider()
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Monsieur Cuisine private publishing", () => {
  it("publishes privately right after creating, because the API always creates a draft", async () => {
    const calls = stubProxy({ status: 200, body: { code: 0, message: "", data: null } });

    const result = await uploadSoup("private-publish");

    expect(calls.map((call) => `${call.method} ${call.endpoint}`)).toEqual([
      "POST api/v3/auth/user/recipes/",
      "PATCH api/v3/auth/user/recipes/42"
    ]);
    expect(calls[1]?.payload).toEqual({ status: "private-publish" });
    expect(result.draft).toMatchObject({ id: 42, status: "private-publish" });
  });

  it("keeps an explicitly requested draft as a draft", async () => {
    const calls = stubProxy({ status: 200, body: { code: 0 } });

    const result = await uploadSoup("draft");

    expect(calls).toHaveLength(1);
    expect(result.draft).toMatchObject({ status: "draft" });
  });

  it("reports why Monsieur Cuisine refused to publish", async () => {
    stubProxy({
      status: 400,
      body: { code: 40004, message: "The recipe data is not complete - servingSizes.0.recipeIngredientGroup.0.name - name should not be empty", data: null }
    });

    const result = await uploadSoup("private-publish");

    expect(result.draft).toMatchObject({ status: "draft", publishError: expect.stringContaining("name should not be empty") });
  });
});

describe("ingredient group names", () => {
  it("never sends an empty group name, which blocks publishing", () => {
    const input = structuredClone(validSoup) as RecipeInput;
    const first = input.servingSize.ingredientGroups[0];
    if (!first) throw new TypeError("fixture has no ingredient group");
    input.servingSize.ingredientGroups.push({ ...first, name: "  " });

    const groups = createSmartRecipePayload(input).servingSizes[0]?.ingredientGroups ?? [];

    expect(groups.map((group) => group.name)).toEqual(["Ingredients", "Ingredients 2"]);
  });
});
