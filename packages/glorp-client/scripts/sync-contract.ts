/**
 * Vendors the Station wire contract into the kit. `src/station/contract.ts` is
 * the single source of truth (and `contract.guard.ts` keeps it in step with the
 * server DTOs); this copies it verbatim so the published package has zero
 * imports back into the app. Run `--check` in CI to fail on drift.
 *
 *   bun packages/glorp-client/scripts/sync-contract.ts           # write
 *   bun packages/glorp-client/scripts/sync-contract.ts --check   # verify
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../../src/station/contract.ts");
const OUT = join(here, "../src/contract.ts");
const HEADER =
  "// GENERATED from src/station/contract.ts by packages/glorp-client/scripts/sync-contract.ts.\n" +
  "// Do not edit — run `bun run client:sync` after changing the server contract.\n\n";

const expected = HEADER + readFileSync(SRC, "utf8");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    /* missing ⇒ drift */
  }
  if (current !== expected) {
    console.error("glorp-client contract.ts is out of date. Run: bun run client:sync");
    process.exit(1);
  }
  console.log("glorp-client contract.ts is in sync.");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, expected);
  console.log("Wrote packages/glorp-client/src/contract.ts");
}
