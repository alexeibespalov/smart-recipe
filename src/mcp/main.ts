#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createLogger, type LogLevel } from "../logging/logger.js";
import { serveMcpOverStdio } from "./protocol.js";
import { createSmartCookerServer, pinnedSettingsFromEnv } from "./tools.js";

// Smart Cooker MCP server (Claude Desktop extension / any MCP client).
// stdout is the protocol channel, so everything else must go to stderr.
console.log = console.error;
console.info = console.error;
console.warn = console.error;

/** Replaced with the extension's manifest version when tsup.claude.config.ts bundles the server. */
declare const __SMART_COOKER_VERSION__: string | undefined;
const VERSION = typeof __SMART_COOKER_VERSION__ === "string" ? __SMART_COOKER_VERSION__ : process.env.SMART_COOKER_VERSION;

const LOG_LEVELS: readonly LogLevel[] = ["silent", "fatal", "error", "warn", "info", "debug", "trace"];

function logLevelFromEnv(): LogLevel {
  return LOG_LEVELS.find((level) => level === process.env.LOG_LEVEL) ?? "info";
}

// Desktop passes empty strings for settings the user left blank; treat those as unset.
const pinnedSettings = pinnedSettingsFromEnv();

serveMcpOverStdio(createSmartCookerServer({
  configPath: process.env.SMART_RECIPE_CONFIG || path.join(os.homedir(), ".smart-recipe"),
  logger: createLogger({ level: logLevelFromEnv(), name: "smart-cooker-mcp", destination: 2 }),
  pinnedSettings,
  waitMs: Number(process.env.SMART_COOKER_WAIT_MS) || undefined,
  version: VERSION
}));
