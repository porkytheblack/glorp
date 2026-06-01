/**
 * Eager batch migration: scan every persisted JSON document under the data
 * dir's `sessions/` tree, classify it (session snapshot vs roster), and upgrade
 * it to the current schema, writing the result back atomically.
 *
 * Documents are normally migrated lazily on load; this proactively upgrades the
 * whole store — handy right after a version bump (`glorp migrate`). It walks
 * both the folder and legacy flat layouts, and skips anything it doesn't own
 * (resources files, mesh agent-state, etc.).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sessionMigrator } from "./session-store.ts";
import { rosterMigrator } from "./roster.ts";
import type { Migrator } from "./engine.ts";

export interface MigrateReport {
  scanned: number;
  migrated: number;
  upToDate: number;
  skipped: number;
  fromFuture: number;
  errors: number;
  details: Array<{ file: string; kind: string; from: number; to: number }>;
}

/** Pick the migrator that owns a parsed document, or null if we don't own it. */
function classify(doc: unknown): Migrator<any> | null {
  if (doc && typeof doc === "object") {
    if (Array.isArray((doc as { messages?: unknown }).messages)) return sessionMigrator;
    if (Array.isArray((doc as { specs?: unknown }).specs)) return rosterMigrator;
  }
  return null;
}

async function* walkJson(dir: string): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkJson(full);
    else if (e.name.endsWith(".json") && !e.name.endsWith(".tmp")) yield full;
  }
}

export async function migrateAllSessions(dataDir: string): Promise<MigrateReport> {
  const root = path.join(dataDir, "sessions");
  const report: MigrateReport = {
    scanned: 0, migrated: 0, upToDate: 0, skipped: 0, fromFuture: 0, errors: 0, details: [],
  };

  for await (const file of walkJson(root)) {
    report.scanned++;
    try {
      const doc = JSON.parse(await fs.promises.readFile(file, "utf-8")) as unknown;
      const migrator = classify(doc);
      if (!migrator) { report.skipped++; continue; }

      const outcome = migrator.migrate(doc);
      if (outcome.fromFuture) { report.fromFuture++; continue; }
      if (outcome.applied.length === 0) { report.upToDate++; continue; }

      // Match each store's on-disk format: rosters are pretty-printed, session
      // snapshots are compact (mirrors GlorpStore / saveRoster).
      const indent = migrator.kind === "roster" ? 2 : undefined;
      const tmp = `${file}.migrating.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(outcome.data, null, indent), "utf-8");
      await fs.promises.rename(tmp, file);
      report.migrated++;
      report.details.push({ file, kind: migrator.kind, from: outcome.fromVersion, to: outcome.toVersion });
    } catch {
      report.errors++;
    }
  }
  return report;
}
