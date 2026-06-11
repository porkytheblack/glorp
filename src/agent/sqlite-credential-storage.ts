/**
 * Optional CredentialStorageAdapter backed by better-sqlite3 — parity with the
 * API-key SqliteKeyStorage. The credentials document is a single JSON value, so
 * it lives as one row in a tiny key/value table. better-sqlite3 is loaded lazily
 * via createRequire so it's never required at install time; prefer
 * FileCredentialStorage unless you specifically need SQLite.
 */

import { createRequire } from "node:module";
import * as path from "node:path";
import type { CredentialsFile } from "./credentials.ts";
import { emptyCredentials, normaliseCredentialsFile, type CredentialStorageAdapter } from "./credential-storage.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
let cached: Db | null = null;

function loadBetterSqlite3(): Db {
  if (cached) return cached;
  try {
    cached = createRequire(import.meta.url)("better-sqlite3");
    return cached;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      "SqliteCredentialStorage requires the optional 'better-sqlite3' package. " +
        "Install it (`bun add better-sqlite3`) or use FileCredentialStorage / MemoryCredentialStorage.\n" +
        `Underlying error: ${reason}`,
    );
  }
}

export interface SqliteCredentialStorageOptions {
  dbPath: string;
  tableName?: string;
}

export class SqliteCredentialStorage implements CredentialStorageAdapter {
  readonly id: string;
  private db: Db;
  private table: string;

  constructor(options: SqliteCredentialStorageOptions) {
    this.table = options.tableName ?? "credentials_doc";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.table)) throw new Error(`Invalid table name "${this.table}"`);
    this.id = `sqlite://${path.resolve(options.dbPath)}#${this.table}`;
    const Database = loadBetterSqlite3();
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL)`);
  }

  load(): CredentialsFile {
    const row = this.db.prepare(`SELECT doc FROM ${this.table} WHERE id = 1`).get();
    if (!row?.doc) return emptyCredentials();
    try {
      return normaliseCredentialsFile(JSON.parse(row.doc));
    } catch {
      return emptyCredentials();
    }
  }

  save(data: CredentialsFile): void {
    this.db
      .prepare(`INSERT INTO ${this.table} (id, doc) VALUES (1, @doc) ON CONFLICT(id) DO UPDATE SET doc = @doc`)
      .run({ doc: JSON.stringify(data) });
  }

  close(): void {
    this.db.close();
  }
}
