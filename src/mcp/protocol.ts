import process from "node:process";
import { isRecord } from "../utils/unknown.js";

// Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0 on stdin/stdout.
// Implements initialize, ping, tools/list, tools/call and, for MCP Apps views, resources/list and resources/read.

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  /** e.g. `{ ui: { resourceUri } }` to show an MCP Apps view with the tool's results. */
  _meta?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /** Data for a linked MCP Apps view; the text content is what the model reads. */
  structuredContent?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
  _meta?: Record<string, unknown>;
  /** Produced on resources/read, so a large view is only loaded when a client asks for it. */
  read(): string;
}

export interface McpServerDefinition {
  serverInfo: { name: string; version: string };
  instructions?: string;
  tools: readonly McpToolDefinition[];
  resources?: readonly McpResource[];
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export type JsonRpcId = string | number;

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string } };

const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Handles one decoded JSON-RPC message. Returns the response, or undefined for notifications. */
export async function handleMcpMessage(definition: McpServerDefinition, message: unknown): Promise<JsonRpcResponse | undefined> {
  if (!isRecord(message) || typeof message.method !== "string") return undefined; // responses or junk: nothing to answer
  const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
  const params = isRecord(message.params) ? message.params : {};

  try {
    const result = await dispatch(definition, message.method, params);
    if (id === undefined) return undefined;
    if (result === METHOD_NOT_FOUND) {
      return { jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${message.method}` } };
    }
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (id === undefined) return undefined;
    return { jsonrpc: "2.0", id, error: { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : String(error) } };
  }
}

async function dispatch(definition: McpServerDefinition, method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === requested) ?? SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          ...(definition.resources?.length ? { resources: { listChanged: false } } : {})
        },
        serverInfo: definition.serverInfo,
        ...(definition.instructions ? { instructions: definition.instructions } : {})
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: definition.tools };
    case "resources/list":
      return {
        resources: (definition.resources ?? []).map(({ uri, name, description, mimeType, _meta }) => ({ uri, name, description, mimeType, _meta }))
      };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read": {
      const resource = (definition.resources ?? []).find((candidate) => candidate.uri === params.uri);
      if (!resource) throw new Error(`Unknown resource: ${String(params.uri)}`);
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.read(), _meta: resource._meta }] };
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = isRecord(params.arguments) ? params.arguments : {};
      try {
        return await definition.callTool(name, args);
      } catch (error) {
        // Tool failures are results the model can read and act on, not protocol errors.
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    }
    default:
      return method.startsWith("notifications/") ? undefined : METHOD_NOT_FOUND;
  }
}

/** Serves the definition on stdin/stdout until stdin closes. */
export function serveMcpOverStdio(definition: McpServerDefinition): void {
  const write = (response: JsonRpcResponse | undefined) => {
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  };

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;

      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } });
        continue;
      }
      for (const item of Array.isArray(message) ? message : [message]) {
        void handleMcpMessage(definition, item).then(write);
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
