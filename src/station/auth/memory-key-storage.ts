/** In-memory ApiKeyStorageAdapter for tests and ephemeral runs (no persistence). */

import type { ApiKey, ApiKeyPublic, ApiKeyStorageAdapter } from "./types.ts";
import { toPublic } from "./types.ts";

export class MemoryKeyStorage implements ApiKeyStorageAdapter {
  private records = new Map<string, ApiKey>();

  insert(record: ApiKey): void {
    this.records.set(record.id, { ...record });
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
    if (r) r.lastUsed = lastUsedIso;
  }

  revoke(id: string): boolean {
    const r = this.records.get(id);
    if (!r) return false;
    r.revoked = true;
    return true;
  }
}
