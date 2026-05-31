/**
 * `glorp station keys <add|list|revoke>` — manage Station API keys against the
 * on-disk key store directly (no running server needed; this is how you mint the
 * first key). The raw key is printed to STDOUT exactly once on `add` so it can be
 * piped (`glorp station keys add ci | pbcopy`); everything else goes to STDERR.
 */

import * as path from "node:path";
import type { CliArgs } from "./cli-args.ts";
import { loadStationConfig } from "./station/config.ts";
import { KeyStore } from "./station/auth/key-store.ts";

export async function runKeys(args: CliArgs): Promise<void> {
  const config = loadStationConfig({ dataDir: args.dataDir });
  const store = new KeyStore(config.auth?.keyStorage ?? path.join(config.dataDir, "glorp-keys.json"));

  try {
    if (args.stationKeysSub === "add") {
      if (!args.keyName) {
        console.error("Usage: glorp station keys add <name> [--scopes admin,run,read]");
        process.exit(1);
      }
      const { key, record } = await store.create(args.keyName, args.scopes);
      console.error(`Created key "${record.name}" (id ${record.id}, scopes: ${record.scopes.join(", ")}).`);
      console.error("Store it now — it will not be shown again:\n");
      console.log(key);
    } else if (args.stationKeysSub === "revoke") {
      if (!args.keyId) {
        console.error("Usage: glorp station keys revoke <id>");
        process.exit(1);
      }
      const ok = await store.revoke(args.keyId);
      console.error(ok ? `Revoked key ${args.keyId}.` : `No key with id ${args.keyId}.`);
      if (!ok) process.exit(1);
    } else {
      const keys = await store.list();
      if (keys.length === 0) {
        console.log("No API keys. Create one: glorp station keys add <name>");
      } else {
        for (const k of keys) {
          const tags = [k.scopes.join(",") || "—", `last_used=${k.lastUsed ?? "never"}`];
          if (k.revoked) tags.push("revoked");
          console.log(`${k.id}  ${k.keyPrefix}…  ${k.name}  [${tags.join("  ")}]`);
        }
      }
    }
  } finally {
    await store.close().catch(() => {});
  }
}
