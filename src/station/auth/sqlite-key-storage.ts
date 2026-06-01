/**
 * Optional ApiKeyStorageAdapter backed by better-sqlite3. The package is loaded
 * lazily via createRequire so it's never required at install time — users who
 * don't construct SqliteKeyStorage never pay for it. Prefer FileKeyStorage (the
 * default) unless you specifically need SQLite.
 */

import { createRequire } from "node:module";
import type { ApiKey, ApiKeyPublic, ApiKeyStorageAdapter } from "./types.ts";

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
      "SqliteKeyStorage requires the optional 'better-sqlite3' package. " +
        "Install it (`bun add better-sqlite3`) or use FileKeyStorage / MemoryKeyStorage.\n" +
        `Underlying error: ${reason}`,
    );
  }
}

export interface SqliteKeyStorageOptions {
  dbPath: string;
  tableName?: string;
}

export class SqliteKeyStorage implements ApiKeyStorageAdapter {
  private db: Db;
  private table: string;

  constructor(options: SqliteKeyStorageOptions) {
    this.table = options.tableName ?? "api_keys";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.table)) throw new Error(`Invalid table name "${this.table}"`);
    const Database = loadBetterSqlite3();
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, last_used TEXT, expires_at TEXT,
        revoked INTEGER NOT NULL DEFAULT 0)`,
    );
  }

  insert(r: ApiKey): void {
    this.db
      .prepare(
        `INSERT INTO ${this.table} (id,name,key_hash,key_prefix,scopes,created_at,last_used,expires_at,revoked)
         VALUES (@id,@name,@key_hash,@key_prefix,@scopes,@created_at,@last_used,@expires_at,@revoked)`,
      )
      .run({
        id: r.id, name: r.name, key_hash: r.keyHash, key_prefix: r.keyPrefix,
        scopes: JSON.stringify(r.scopes), created_at: r.createdAt,
        last_used: r.lastUsed, expires_at: r.expiresAt, revoked: r.revoked ? 1 : 0,
      });
  }

  findByHash(keyHash: string): ApiKey | null {
    const row = this.db.prepare(`SELECT * FROM ${this.table} WHERE key_hash = ?`).get(keyHash);
    return row ? rowToKey(row) : null;
  }

  list(): ApiKeyPublic[] {
    const rows = this.db.prepare(`SELECT * FROM ${this.table} ORDER BY created_at DESC`).all();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((row: any) => {
      const { keyHash: _keyHash, ...pub } = rowToKey(row);
      void _keyHash;
      return pub;
    });
  }

  touch(id: string, lastUsedIso: string): void {
    this.db.prepare(`UPDATE ${this.table} SET last_used = ? WHERE id = ?`).run(lastUsedIso, id);
  }

  revoke(id: string): boolean {
    return this.db.prepare(`UPDATE ${this.table} SET revoked = 1 WHERE id = ?`).run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToKey(row: any): ApiKey {
  return {
    id: row.id, name: row.name, keyHash: row.key_hash, keyPrefix: row.key_prefix,
    scopes: JSON.parse(row.scopes), createdAt: row.created_at,
    lastUsed: row.last_used ?? null, expiresAt: row.expires_at ?? null, revoked: Boolean(row.revoked),
  };
}
