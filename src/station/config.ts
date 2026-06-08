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
  /**
   * Idle reclamation: a *loaded* session whose handle has sat idle (not busy, no
   * connected WS client) longer than this is UNLOADED — the agent host (model
   * adapter + any child processes) is freed while the on-disk snapshot is kept,
   * so the session rehydrates transparently on next access. `0` disables the GC.
   * Default 30 min. Tune with `GLORP_STATION_IDLE_TTL_MS`.
   */
  idleSessionTtlMs: number;
  /** How often the idle-session GC sweeps. Default 60s. `GLORP_STATION_GC_INTERVAL_MS`. */
  gcIntervalMs: number;
  auth?: StationAuthConfig;
}

/** Default idle-session TTL: 30 minutes. */
export const DEFAULT_IDLE_TTL_MS = 30 * 60_000;
/** Default GC sweep interval: 60 seconds. */
export const DEFAULT_GC_INTERVAL_MS = 60_000;

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
  idleSessionTtlMs?: number;
  gcIntervalMs?: number;
  auth?: { enabled?: boolean };
}

/**
 * Parse a bounded INTEGER env var; undefined when unset/invalid. Rejects
 * non-integers (e.g. `"0.5"`) outright rather than flooring them — silently
 * turning `0.5` into `0` would disable the GC TTL the operator meant to set.
 */
function envInt(name: string, min: number): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : undefined;
}

/** Validate a `station.json` integer field against a floor; undefined if bad. */
function fileInt(value: unknown, min: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min ? value : undefined;
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
    // TTL floor 0 (0 disables the GC); interval floor 1ms so a bad value can
    // never drive setInterval into a hot loop.
    idleSessionTtlMs:
      envInt("GLORP_STATION_IDLE_TTL_MS", 0) ??
      fileInt(file.idleSessionTtlMs, 0) ??
      DEFAULT_IDLE_TTL_MS,
    gcIntervalMs:
      envInt("GLORP_STATION_GC_INTERVAL_MS", 1) ??
      fileInt(file.gcIntervalMs, 1) ??
      DEFAULT_GC_INTERVAL_MS,
    auth: {
      // undefined ⇒ server applies the loopback-aware default at startup.
      enabled: overrides.auth?.enabled ?? envAuthEnabled() ?? file.auth?.enabled,
      keyStorage: overrides.auth?.keyStorage,
    },
  };
}
