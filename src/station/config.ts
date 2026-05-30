/**
 * Station configuration. Resolved from `<dataDir>/station.json` (if present),
 * then overlaid with CLI flag overrides. Everything has a sane default so
 * `glorp station` works with zero config.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";

/** Distinct from the single-session server's 3271 so both can run side by side. */
export const STATION_DEFAULT_PORT = 4271;

export interface StationConfig {
  hostname: string;
  port: number;
  dataDir: string;
  workspaceRoot: string;
  templatesDir: string;
  defaultProvider?: string;
  defaultModel?: string;
  permissionMode: PermissionMode;
  /** Serve the optional Glorp Dashboard SPA at `/` when true. */
  dashboard: boolean;
}

export interface StationConfigOverrides {
  hostname?: string;
  port?: number;
  dataDir?: string;
  workspaceRoot?: string;
  provider?: string;
  model?: string;
  permissionMode?: PermissionMode;
  dashboard?: boolean;
}

interface StationFileConfig {
  hostname?: string;
  port?: number;
  workspaceRoot?: string;
  templatesDir?: string;
  defaultProvider?: string;
  defaultModel?: string;
  permissionMode?: PermissionMode;
  dashboard?: boolean;
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
    dashboard: overrides.dashboard ?? file.dashboard ?? false,
  };
}
