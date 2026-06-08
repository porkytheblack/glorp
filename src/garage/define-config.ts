/**
 * `defineConfig` — the ergonomic entry for embedding Garage in your own code
 * (mirrors the Garage ecosystem's `defineConfig`). Merges your overrides with
 * defaults + `<dataDir>/garage.json` + env, and returns a fully-resolved
 * `GarageConfig` you can hand to `startGarage`. Use the `auth.keyStorage`
 * field to plug in a custom key backend:
 *
 *   import { defineConfig } from "./garage/define-config.ts";
 *   import { startGarage } from "./garage/server.ts";
 *   import { SqliteKeyStorage } from "./garage/auth/index.ts";
 *
 *   await startGarage(defineConfig({
 *     hostname: "0.0.0.0",
 *     auth: { enabled: true, keyStorage: new SqliteKeyStorage({ dbPath: "keys.db" }) },
 *   }));
 */

import { loadGarageConfig, type GarageConfig, type GarageConfigOverrides } from "./config.ts";

export function defineConfig(overrides: GarageConfigOverrides = {}): GarageConfig {
  return loadGarageConfig(overrides);
}
