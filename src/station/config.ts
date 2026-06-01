/**
 * Station configuration. Resolved from `<dataDir>/station.json` (if present),
 * then overlaid with CLI flag overrides. Everything has a sane default so
 * `glorp station` works with zero config.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";
import type { ApiKeyStorageAdapter } from "./auth/types.ts";

/** Distinct from the single-session server's 3271 so both can run side by side. */
export const STATION_DEFAULT_PORT = 4271;

/**
 * API-key auth. `enabled` left undefined means "auto": required when bound to a
 * non-loopback host, open on loopback (preserves localhost dev + tests).
 * `keyStorage` is a code-only escape hatch for a custom backend (SQLite, etc.);
 * the default is a file at `<dataDir>/glorp-keys.json`.
 */
export interface StationAuthConfig {
  enabled?: boolean;
  keyStorage?: ApiKeyStorageAdapter;
}

export interface StationConfig {
  hostname: string;
  port: number;
  dataDir: string;
  workspaceRoot: string;
  templatesDir: string;
  defaultProvider?: string;
  defaultModel?: string;
  permissionMode: PermissionMode;
  /** Name of the per-session file-exchange subfolder. Defaults to `uploads`. */
  filesDir?: string;
  auth?: StationAuthConfig;
}

export interface StationConfigOverrides {
  hostname?: string;
  port?: number;
  dataDir?: string;
  workspaceRoot?: string;
  provider?: string;
  model?: string;
  permissionMode?: PermissionMode;
  auth?: StationAuthConfig;
}

interface StationFileConfig {
  hostname?: string;
  port?: number;
  workspaceRoot?: string;
  templatesDir?: string;
  defaultProvider?: string;
  defaultModel?: string;
  permissionMode?: PermissionMode;
  filesDir?: string;
  auth?: { enabled?: boolean };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True when binding to a loopback-only interface (auth optional there). */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname);
}

/**
 * Resolve whether API-key auth is enforced: explicit `auth.enabled` wins; else
 * auto — required for any non-loopback bind (i.e. reachable from other hosts).
 */
export function authRequired(config: StationConfig): boolean {
  return config.auth?.enabled ?? !isLoopbackHost(config.hostname);
}

function envAuthEnabled(): boolean | undefined {
  const v = process.env.GLORP_STATION_AUTH?.toLowerCase();
  if (v === "required" || v === "on" || v === "true") return true;
  if (v === "off" || v === "false") return false;
  return undefined;
}

function readFileConfig(dataDir: string): StationFileConfig {
  const p = path.join(dataDir, "station.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as StationFileConfig;
  } catch {
    return {};
  }
}

/** Build the effective config from defaults + station.json + CLI overrides. */
export function loadStationConfig(overrides: StationConfigOverrides = {}): StationConfig {
  const dataDir =
    overrides.dataDir ?? process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  const file = readFileConfig(dataDir);
  const port =
    overrides.port ??
    (process.env.GLORP_STATION_PORT ? Number(process.env.GLORP_STATION_PORT) : undefined) ??
    file.port ??
    STATION_DEFAULT_PORT;
  return {
    hostname: overrides.hostname ?? file.hostname ?? "127.0.0.1",
    port,
    dataDir,
    workspaceRoot:
      overrides.workspaceRoot ?? file.workspaceRoot ?? path.join(dataDir, "workspaces"),
    templatesDir: file.templatesDir ?? path.join(dataDir, "templates"),
    defaultProvider: overrides.provider ?? file.defaultProvider,
    defaultModel: overrides.model ?? file.defaultModel,
    permissionMode: overrides.permissionMode ?? file.permissionMode ?? "normal",
    filesDir: file.filesDir,
    auth: {
      // undefined ⇒ server applies the loopback-aware default at startup.
      enabled: overrides.auth?.enabled ?? envAuthEnabled() ?? file.auth?.enabled,
      keyStorage: overrides.auth?.keyStorage,
    },
  };
}
