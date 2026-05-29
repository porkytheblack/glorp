/**
 * Generic, forward-only schema migration engine for glorp's persisted stores.
 *
 * Every persisted document carries an integer `version`. A store kind (session
 * snapshot, roster, …) owns an ordered chain of migrations; each migration is a
 * pure `up(doc)` transform that upgrades the document from version `to - 1` to
 * version `to`. On load we run every migration newer than the document's
 * version, in order, then stamp the result.
 *
 * Shipping a schema change = append one `{ to, description, up }` entry to that
 * store's chain. The current version is derived from the chain length, so
 * there's no second number to keep in sync.
 *
 * Rules:
 *   - Forward only. We never downgrade.
 *   - Documents from a newer build than we understand are left untouched and
 *     flagged `fromFuture`, so an older binary never clobbers newer data.
 *   - `up` transforms must be pure and total (handle missing/garbage fields).
 */

export interface Migration {
  /** Version this migration produces (upgrades `to - 1` → `to`). */
  to: number;
  /** Human-readable description, surfaced in logs and `glorp migrate`. */
  description: string;
  /** Pure transform from the previous version's shape to this version's. */
  up: (doc: Record<string, any>) => Record<string, any>;
}

export interface MigrateOutcome<T> {
  /** The (possibly) upgraded document, stamped to the current version. */
  data: T;
  fromVersion: number;
  toVersion: number;
  /** Migrations that actually ran (empty when already current). */
  applied: Migration[];
  /** True when the document was written by a newer schema than this build. */
  fromFuture: boolean;
}

export class Migrator<T extends { version?: number }> {
  readonly currentVersion: number;

  constructor(readonly kind: string, private readonly migrations: Migration[]) {
    migrations.forEach((m, i) => {
      if (m.to !== i + 1) {
        throw new Error(
          `[migrations:${kind}] chain must be contiguous starting at 1; entry ${i} has to=${m.to} (expected ${i + 1})`,
        );
      }
    });
    this.currentVersion = migrations.length;
  }

  /** Read the document's stored version (absent/garbage ⇒ 0 = pre-versioning). */
  versionOf(raw: unknown): number {
    const v = (raw as { version?: unknown } | null)?.version;
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
  }

  /** Bring a parsed document up to {@link currentVersion}. */
  migrate(raw: unknown): MigrateOutcome<T> {
    const from = this.versionOf(raw);
    let doc: Record<string, any> = raw && typeof raw === "object" ? { ...(raw as object) } : {};

    if (from > this.currentVersion) {
      return { data: doc as T, fromVersion: from, toVersion: from, applied: [], fromFuture: true };
    }

    const applied: Migration[] = [];
    for (const m of this.migrations) {
      if (m.to <= from) continue;
      doc = m.up(doc);
      doc.version = m.to;
      applied.push(m);
    }
    doc.version = this.currentVersion;
    return { data: doc as T, fromVersion: from, toVersion: this.currentVersion, applied, fromFuture: false };
  }

  /** Whether a parsed document needs migrating (and is safe to migrate). */
  needsMigration(raw: unknown): boolean {
    const from = this.versionOf(raw);
    return from < this.currentVersion;
  }
}
