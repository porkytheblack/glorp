/**
 * Default ApiKeyStorageAdapter backed by a JSON file (no native deps). Writes go
 * through a fsync'd tmp file + rename, with a best-effort parent-dir fsync, so
 * the keys file survives a crash. The file is `0o600` and its dir `0o700` so a
 * default umask doesn't expose key metadata. Single-process only — for
 * multi-process deployments implement ApiKeyStorageAdapter against a database.
 */

import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { ApiKey, ApiKeyPublic, ApiKeyStorageAdapter } from "./types.ts";
import { toPublic } from "./types.ts";

export class FileKeyStorage implements ApiKeyStorageAdapter {
  private records = new Map<string, ApiKey>();

  constructor(private filePath: string) {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8")) as ApiKey[];
      if (Array.isArray(data)) for (const r of data) this.records.set(r.id, r);
    } catch {
      // Corrupt/unreadable — start fresh rather than throwing.
    }
  }

  private flush(): void {
    const tmp = `${this.filePath}.tmp`;
    const body = JSON.stringify([...this.records.values()], null, 2);
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
    try {
      const dirFd = openSync(dirname(this.filePath), "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Directory fsync isn't supported on every platform; tmp fsync + rename
      // already give us most of the durability we can offer.
    }
  }

  insert(record: ApiKey): void {
    this.records.set(record.id, { ...record });
    this.flush();
  }

  findByHash(keyHash: string): ApiKey | null {
    for (const r of this.records.values()) if (r.keyHash === keyHash) return { ...r };
    return null;
  }

  list(): ApiKeyPublic[] {
    return [...this.records.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublic);
  }

  touch(id: string, lastUsedIso: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.lastUsed = lastUsedIso;
    this.flush();
  }

  revoke(id: string): boolean {
    const r = this.records.get(id);
    if (!r) return false;
    r.revoked = true;
    this.flush();
    return true;
  }
}
