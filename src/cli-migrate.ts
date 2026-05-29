/**
 * `glorp migrate` — eagerly upgrade every persisted store to the current
 * schema. Migrations also run lazily on load; this is the proactive, whole-
 * store pass you run after upgrading glorp.
 */

import * as path from "node:path";
import * as os from "node:os";
import { migrateAllSessions } from "./agent/migrations/migrate-all.ts";
import { sessionMigrator } from "./agent/migrations/session-store.ts";
import { rosterMigrator } from "./agent/migrations/roster.ts";
import type { CliArgs } from "./cli-args.ts";

export async function runMigrate(_args: CliArgs): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  console.log(`glorp migrate — data dir: ${dataDir}`);
  console.log(`schema versions: session=v${sessionMigrator.currentVersion}, roster=v${rosterMigrator.currentVersion}\n`);

  const report = await migrateAllSessions(dataDir);
  for (const d of report.details) {
    console.log(`  ✓ ${d.kind.padEnd(8)} ${path.relative(dataDir, d.file)}  v${d.from} → v${d.to}`);
  }

  console.log(
    `\nscanned ${report.scanned} · migrated ${report.migrated} · up-to-date ${report.upToDate} · ` +
    `unowned ${report.skipped} · newer-than-build ${report.fromFuture} · errors ${report.errors}`,
  );
  if (report.fromFuture > 0) {
    console.log(`\n⚠ ${report.fromFuture} document(s) were written by a newer glorp and left untouched.`);
  }
}
