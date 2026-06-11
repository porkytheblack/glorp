/**
 * KeyStore — owns all crypto for API keys (uuid id, sha256 hashing, random key
 * generation, verification) and delegates persistence to an
 * ApiKeyStorageAdapter. Pass an adapter, or a string path to use the default
 * FileKeyStorage at that path. Mirrors the Garage ecosystem's KeyStore.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ApiKey, ApiKeyPublic, ApiKeyStorageAdapter } from "./types.ts";
import { FileKeyStorage } from "./file-key-storage.ts";

/** Raw keys look like `glsk_<32 url-safe chars>`. */
export const KEY_PREFIX = "glsk_";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export class KeyStore {
  private adapter: ApiKeyStorageAdapter;

  constructor(storageOrPath: ApiKeyStorageAdapter | string) {
    this.adapter = typeof storageOrPath === "string" ? new FileKeyStorage(storageOrPath) : storageOrPath;
  }

  /** Generate a new key, persist its hash, and return the raw key ONCE. */
  async create(
    name: string,
    scopes: string[] = ["admin"],
    opts: { namespace?: string | null } = {},
  ): Promise<{ key: string; record: ApiKey }> {
    const key = KEY_PREFIX + randomBytes(24).toString("base64url");
    const record: ApiKey = {
      id: randomUUID(),
      name,
      keyHash: sha256(key),
      keyPrefix: key.slice(0, 12),
      scopes: scopes.length ? scopes : ["admin"],
      createdAt: new Date().toISOString(),
      lastUsed: null,
      expiresAt: null,
      revoked: false,
      namespace: opts.namespace ?? null,
    };
    await this.adapter.insert(record);
    return { key, record };
  }

  /** Verify a presented raw key. Returns the record (and touches lastUsed) or null. */
  async verify(rawKey: string): Promise<ApiKey | null> {
    if (!rawKey) return null;
    const record = await this.adapter.findByHash(sha256(rawKey));
    if (!record || record.revoked) return null;
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return null;
    await this.adapter.touch(record.id, new Date().toISOString());
    return record;
  }

  async list(): Promise<ApiKeyPublic[]> {
    return this.adapter.list();
  }

  async revoke(id: string): Promise<boolean> {
    return this.adapter.revoke(id);
  }

  async close(): Promise<void> {
    await this.adapter.close?.();
  }
}
