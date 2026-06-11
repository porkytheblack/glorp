/**
 * `glorp garage keys <add|list|revoke>` — manage Garage API keys against the
 * on-disk key store directly (no running server needed; this is how you mint the
 * first key). The raw key is printed to STDOUT exactly once on `add` so it can be
 * piped (`glorp garage keys add ci | pbcopy`); everything else goes to STDERR.
 */

import * as path from "node:path";
import type { CliArgs } from "./cli-args.ts";
import { loadGarageConfig } from "./garage/config.ts";
import { KeyStore } from "./garage/auth/key-store.ts";

export async function runKeys(args: CliArgs): Promise<void> {
  const config = loadGarageConfig({ dataDir: args.dataDir });
  const store = new KeyStore(config.auth?.keyStorage ?? path.join(config.dataDir, "glorp-keys.json"));

  try {
    if (args.garageKeysSub === "add") {
      if (!args.keyName) {
        console.error("Usage: glorp garage keys add <name> [--scopes admin,run,read] [--namespace <id>]");
        process.exit(1);
      }
      const scopes = args.namespace && !args.scopes ? ["run", "read"] : args.scopes;
      if (args.namespace && (scopes ?? []).includes("admin")) {
        console.error("A namespace-bound key cannot have the 'admin' scope (it would defeat isolation).");
        process.exit(1);
      }
      const { key, record } = await store.create(args.keyName, scopes, { namespace: args.namespace ?? null });
      const ns = record.namespace ? `, namespace: ${record.namespace}` : "";
      console.error(`Created key "${record.name}" (id ${record.id}, scopes: ${record.scopes.join(", ")}${ns}).`);
      console.error("Store it now — it will not be shown again:\n");
      console.log(key);
    } else if (args.garageKeysSub === "revoke") {
      if (!args.keyId) {
        console.error("Usage: glorp garage keys revoke <id>");
        process.exit(1);
      }
      const ok = await store.revoke(args.keyId);
      console.error(ok ? `Revoked key ${args.keyId}.` : `No key with id ${args.keyId}.`);
      if (!ok) process.exit(1);
    } else {
      const keys = await store.list();
      if (keys.length === 0) {
        console.log("No API keys. Create one: glorp garage keys add <name>");
      } else {
        for (const k of keys) {
          const tags = [k.scopes.join(",") || "—", `ns=${k.namespace ?? "default"}`, `last_used=${k.lastUsed ?? "never"}`];
          if (k.revoked) tags.push("revoked");
          console.log(`${k.id}  ${k.keyPrefix}…  ${k.name}  [${tags.join("  ")}]`);
        }
      }
    }
  } finally {
    await store.close().catch(() => {});
  }
}
