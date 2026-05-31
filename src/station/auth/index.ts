/** Public surface of the Station auth layer (key store + storage adapters). */

export type { ApiKey, ApiKeyPublic, ApiKeyStorageAdapter } from "./types.ts";
export { KeyStore, KEY_PREFIX } from "./key-store.ts";
export { FileKeyStorage } from "./file-key-storage.ts";
export { MemoryKeyStorage } from "./memory-key-storage.ts";
export { SqliteKeyStorage, type SqliteKeyStorageOptions } from "./sqlite-key-storage.ts";
export { requireAuth, requireScope, extractKey, type AuthResult } from "./middleware.ts";
