/**
 * API-key storage types. Mirrors the Station ecosystem's pluggable key store:
 * the `KeyStore` owns all crypto (id/hash/generation/verification) and delegates
 * persistence to an `ApiKeyStorageAdapter`. Implementations may be sync or
 * async — the KeyStore awaits results either way.
 */

export interface ApiKey {
  id: string;
  name: string;
  /** sha256 hex of the raw key. The raw key is never stored. */
  keyHash: string;
  /** First 12 chars of the raw key, e.g. "glsk_ab12cd". Safe to display. */
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsed: string | null;
  expiresAt: string | null;
  revoked: boolean;
}

/** Public view of a key — never includes the hash. */
export type ApiKeyPublic = Omit<ApiKey, "keyHash">;

export interface ApiKeyStorageAdapter {
  insert(record: ApiKey): Promise<void> | void;
  findByHash(keyHash: string): Promise<ApiKey | null> | ApiKey | null;
  list(): Promise<ApiKeyPublic[]> | ApiKeyPublic[];
  touch(id: string, lastUsedIso: string): Promise<void> | void;
  revoke(id: string): Promise<boolean> | boolean;
  close?(): Promise<void> | void;
}

/** Drop the secret hash from a record for public listing. */
export function toPublic(record: ApiKey): ApiKeyPublic {
  const { keyHash: _keyHash, ...pub } = record;
  void _keyHash;
  return pub;
}
