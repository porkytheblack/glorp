/**
 * `defineConfig` — the ergonomic entry for embedding Station in your own code
 * (mirrors the Station ecosystem's `defineConfig`). Merges your overrides with
 * defaults + `<dataDir>/station.json` + env, and returns a fully-resolved
 * `StationConfig` you can hand to `startStation`. Use the `auth.keyStorage`
 * field to plug in a custom key backend:
 *
 *   import { defineConfig } from "./station/define-config.ts";
 *   import { startStation } from "./station/server.ts";
 *   import { SqliteKeyStorage } from "./station/auth/index.ts";
 *
 *   await startStation(defineConfig({
 *     hostname: "0.0.0.0",
 *     auth: { enabled: true, keyStorage: new SqliteKeyStorage({ dbPath: "keys.db" }) },
 *   }));
 */

import { loadStationConfig, type StationConfig, type StationConfigOverrides } from "./config.ts";

export function defineConfig(overrides: StationConfigOverrides = {}): StationConfig {
  return loadStationConfig(overrides);
}
