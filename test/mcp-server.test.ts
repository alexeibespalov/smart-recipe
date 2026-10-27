import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { handleMcpMessage, type McpServerDefinition, type McpToolResult } from "../src/mcp/protocol.js";
import { uploadConfirmation } from "../src/mcp/presentation.js";
import { defaultRecipeStatus } from "../src/pipeline/assistant-recipes.js";
import { CARD_RESOURCE_URI, SMART_COOKER_TOOLS, createSmartCookerServer, pinnedSettingsFromEnv } from "../src/mcp/tools.js";
import { soupWithStep6Mode, validSoup } from "./fixtures/mc-recipes.js";

const echoServer: McpServerDefinition = {
  serverInfo: { name: "test", version: "0.0.0" },
  tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }],
  async callTool(name, args) {
    if (name === "boom") throw new Error("exploded");
    return { content: [{ type: "text", text: JSON.stringify({ name, args }) }] };
  }
};

function server(): McpServerDefinition {
  return createSmartCookerServer({
    configPath: path.join(os.tmpdir(), `smart-cooker-test-${process.pid}-missing`),
    logger: createLogger(),
    pinnedSettings: { TARGET_DEVICE: "mc", MC_LOCALE: "en-US" },
    waitMs: 5_000
  });
}

function body(result: McpToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (!first) throw new TypeError("tool returned no content");
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe("MCP protocol", () => {
  it("negotiates a supported protocol version and falls back to the latest", async () => {
    const known = await handleMcpMessage(echoServer, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(known).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "test" } } });

    const unknown = await handleMcpMessage(echoServer, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(unknown).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("ignores notifications and rejects unknown methods", async () => {
    expect(await handleMcpMessage(echoServer, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(await handleMcpMessage(echoServer, { jsonrpc: "2.0", id: 3, method: "bogus" })).toMatchObject({
      id: 3,
      error: { code: -32601 }
    });
  });

  it("lists tools and turns tool exceptions into error results", async () => {
    expect(await handleMcpMessage(echoServer, { jsonrpc: "2.0", id: 4, method: "tools/list" })).toMatchObject({
      result: { tools: [{ name: "echo" }] }
    });
    expect(await handleMcpMessage(echoServer, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom" } })).toMatchObject({
      result: { isError: true, content: [{ type: "text", text: "exploded" }] }
    });
  });
});

describe("smart-cooker tools", () => {
  it("prepares a brief from pasted text without any LLM", async () => {
    const result = await server().callTool("prepare_recipe", { text: "Tomato soup for 2.", title: "Tomato soup" });
    expect(result.isError).toBeUndefined();
    const brief = body(result).result as Record<string, unknown>;
    expect(brief).toMatchObject({ device: "mc", locale: "en-US", title: "Tomato soup", excludeModes: ["foodProcessor"] });
    expect(String(brief.task)).toContain("Tomato soup for 2.");
  });

  it("requires exactly one recipe source", async () => {
    const result = await server().callTool("prepare_recipe", { url: "https://example.com", text: "soup" });
    expect(result.isError).toBe(true);
    expect(body(result).error).toBe("Provide exactly one of 'url' or 'text'.");
  });

  it("validates assistant-written recipes", async () => {
    const ok = await server().callTool("validate_recipe", { recipe: validSoup });
    expect(body(ok).result).toMatchObject({ ok: true, errors: [] });

    const invalid = await server().callTool("validate_recipe", { recipe: soupWithStep6Mode({ speed: 5 }) });
    const verdict = body(invalid).result as { ok: boolean; errors: string[] };
    expect(verdict.ok).toBe(false);
    expect(verdict.errors).toContain("/servingSize/steps/6/mode/speed must be <= 3");
  });

  it("refuses to upload an invalid recipe before touching the network", async () => {
    const result = await server().callTool("upload_recipe", { recipe: soupWithStep6Mode({ speed: 5 }) });
    expect(result.isError).toBe(true);
    expect(body(result).result).toMatchObject({ ok: false });
  });

  it("rejects unknown devices, locales and tools", async () => {
    expect(body(await server().callTool("validate_recipe", { recipe: validSoup, device: "oven" }))).toMatchObject({ error: "'device' must be 'mc' or 'tm'." });
    expect(body(await server().callTool("prepare_recipe", { text: "soup", locale: "xx-XX" })).error).toContain("Unsupported locale");
    expect((await server().callTool("nope", {})).isError).toBe(true);
  });
});

describe("pinnedSettingsFromEnv", () => {
  it("keeps only settings the user actually set in Claude Desktop", () => {
    expect(pinnedSettingsFromEnv({
      TARGET_DEVICE: "tm",
      MC_LOCALE: "",
      TM_VERSION: "${user_config.tm_version}",
      MC_HAS_FOOD_PROCESSOR: "false",
      UNRELATED: "x"
    })).toEqual({ TARGET_DEVICE: "tm", MC_HAS_FOOD_PROCESSOR: "false" });
  });
});

describe("smart-cooker conversation guidance (no separate skill)", () => {
  it("returns the presentation guide and next step with the brief", async () => {
    const result = body(await server().callTool("prepare_recipe", { text: "Tomato soup for 2.", title: "Tomato soup" })).result as Record<string, unknown>;
    expect(String(result.presentation)).toContain("Mode labels:");
    expect(String(result.presentation)).toContain("cooking pot");
    expect(String(result.next)).toContain("validate_recipe");
  });

  it("tells the model what to do after validation", async () => {
    const ok = body(await server().callTool("validate_recipe", { recipe: validSoup })).result as Record<string, unknown>;
    expect(String(ok.next)).toContain("Send it to your cooker?");
    const invalid = body(await server().callTool("validate_recipe", { recipe: soupWithStep6Mode({ speed: 5 }) })).result as Record<string, unknown>;
    expect(String(invalid.next)).toContain("Fix exactly the fields");
  });

  it("words the upload confirmation by device and status", () => {
    expect(uploadConfirmation("mc", { status: "private-publish", recipeUrl: "https://x" })).toBe("📱 It's on the cooker screen under the created recipes. Web link: https://x");
    expect(uploadConfirmation("mc", { status: "draft" })).toContain("web draft");
    expect(uploadConfirmation("tm", {})).toContain("Cookidoo Created Recipes");
  });

  it("puts the triggers and send rule into the tool descriptions", () => {
    const describe = (name: string) => SMART_COOKER_TOOLS.find((tool) => tool.name === name)?.description ?? "";
    expect(describe("prepare_recipe")).toContain("put this on my cooker");
    expect(describe("upload_recipe")).toContain("never claim a recipe is on the cooker");
    expect(describe("connect_account")).toContain("log in");
  });
});

describe("recipe status", () => {
  it("defaults Monsieur Cuisine uploads to private and never allows community submission", () => {
    expect(defaultRecipeStatus("mc")).toBe("private-publish");
    expect(defaultRecipeStatus("mc", "draft")).toBe("draft");
    expect(() => defaultRecipeStatus("mc", "publish")).toThrow(/community submission is not supported/);
    expect(() => defaultRecipeStatus("mc", "community")).toThrow();
  });

  it("refuses any other status before touching the account", async () => {
    const result = await server().callTool("upload_recipe", { recipe: validSoup, status: "publish" });
    expect(result.isError).toBe(true);
    expect(body(result).error).toContain("never submitted to the community");
  });
});

describe("recipe-card MCP App", () => {
  const withCard = () => createSmartCookerServer({
    configPath: path.join(os.tmpdir(), `smart-cooker-test-${process.pid}-missing`),
    logger: createLogger(),
    pinnedSettings: { TARGET_DEVICE: "mc", MC_LOCALE: "en-US" },
    cardHtml: () => "<!doctype html><title>card</title>"
  });

  it("links upload_recipe and list_recipes to the card view", () => {
    const uri = (name: string) => (SMART_COOKER_TOOLS.find((tool) => tool.name === name)?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri;
    expect(uri("upload_recipe")).toBe(CARD_RESOURCE_URI);
    expect(uri("list_recipes")).toBe(CARD_RESOURCE_URI);
    expect(uri("prepare_recipe")).toBeUndefined();
  });

  it("serves the card through resources/list and resources/read", async () => {
    const definition = withCard();
    const init = await handleMcpMessage(definition, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(init).toMatchObject({ result: { capabilities: { resources: {} } } });

    const listed = await handleMcpMessage(definition, { jsonrpc: "2.0", id: 2, method: "resources/list" });
    expect(listed).toMatchObject({ result: { resources: [{ uri: CARD_RESOURCE_URI, mimeType: "text/html;profile=mcp-app" }] } });

    const read = await handleMcpMessage(definition, { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: CARD_RESOURCE_URI } });
    expect(read).toMatchObject({
      result: {
        contents: [{
          uri: CARD_RESOURCE_URI,
          mimeType: "text/html;profile=mcp-app",
          text: "<!doctype html><title>card</title>",
          _meta: { ui: { csp: { resourceDomains: expect.arrayContaining(["https://mc-web-user-content-cdn.tecpal.com"]) } } }
        }]
      }
    });
    expect(await handleMcpMessage(definition, { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "ui://nope" } })).toMatchObject({ error: {} });
  });

  it("gives an invalid upload a view so the card says it is being fixed", async () => {
    const result = await withCard().callTool("upload_recipe", { recipe: soupWithStep6Mode({ speed: 5 }) });
    expect(result.structuredContent).toMatchObject({ kind: "invalid", errors: expect.arrayContaining(["/servingSize/steps/6/mode/speed must be <= 3"]) });
  });
});

describe("upload card", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the recipe card and a published upload for the view", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const call = JSON.parse(init.body) as { method: string };
      const body = call.method === "POST"
        ? { code: 0, message: "", data: { recipe: { id: 42, title: "Silky Tomato Soup", status: "draft" } } }
        : { code: 0, message: "", data: null };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const definition = createSmartCookerServer({
      configPath: path.join(os.tmpdir(), `smart-cooker-test-${process.pid}-missing`),
      logger: createLogger(),
      pinnedSettings: { TARGET_DEVICE: "mc", MC_LOCALE: "en-US", MC_COOKIE: "session=test" }
    });

    const result = await definition.callTool("upload_recipe", { recipe: validSoup, no_image: true });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      kind: "upload",
      card: { title: "Silky Tomato Soup", emoji: "🍲" },
      upload: { status: "private-publish", published: true }
    });
    expect(body(result).result).toMatchObject({ status: "private-publish", tellUser: expect.stringContaining("on the cooker screen") });
  });
});

describe("recipe list view", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the search on so the card can say how many matched", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      code: 0,
      message: "",
      data: { total: 34, totalPage: 2, recipes: [{ id: 7, title: "Sauerkraut soup", status: "private-publish" }, { id: 8, title: "Borscht", status: "draft" }] }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const definition = createSmartCookerServer({
      configPath: path.join(os.tmpdir(), `smart-cooker-test-${process.pid}-missing`),
      logger: createLogger(),
      pinnedSettings: { TARGET_DEVICE: "mc", MC_LOCALE: "en-US", MC_COOKIE: "session=test" }
    });

    const result = await definition.callTool("list_recipes", { search: "sauerkraut" });

    expect(result.structuredContent).toMatchObject({
      kind: "list",
      total: 34,
      search: "sauerkraut",
      recipes: [{ title: "Sauerkraut soup", emoji: "🍲" }]
    });
  });
});
