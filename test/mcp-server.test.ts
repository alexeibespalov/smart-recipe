import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { handleMcpMessage, type McpServerDefinition, type McpToolResult } from "../src/mcp/protocol.js";
import { uploadConfirmation } from "../src/mcp/presentation.js";
import { defaultRecipeStatus } from "../src/pipeline/assistant-recipes.js";
import { SMART_COOKER_TOOLS, createSmartCookerServer, pinnedSettingsFromEnv } from "../src/mcp/tools.js";
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
