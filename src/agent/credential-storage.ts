/**
 * Pluggable persistence for the credentials document — mirrors the API-key
 * `ApiKeyStorageAdapter` pattern. `CredentialsStore` owns the in-memory model
 * and all mutation logic; an adapter only loads and saves the whole
 * `CredentialsFile`. Default is `FileCredentialStorage` (a 0o600
 * `credentials.json`); `MemoryCredentialStorage` is for tests and ephemeral
 * sessions. New backends (sqlite, secrets manager, OS keychain) implement the
 * same two methods.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { CredentialsFile } from "./credentials.ts";

/** An empty, well-formed credentials document. */
export function emptyCredentials(): CredentialsFile {
  return { version: 1, providers: {}, profiles: [] };
}

/** Coerce arbitrary parsed JSON into a valid `CredentialsFile` (or empty). */
export function normaliseCredentialsFile(parsed: unknown): CredentialsFile {
  const p = parsed as CredentialsFile | null;
  if (!p || p.version !== 1 || typeof p.providers !== "object") return emptyCredentials();
  return {
    version: 1,
    providers: p.providers,
    profiles: Array.isArray(p.profiles) ? p.profiles : [],
    activeProfileId: p.activeProfileId,
  };
}

export interface CredentialStorageAdapter {
  /** Stable identity used to dedupe stores (e.g. a file path). */
  readonly id: string;
  /** Read the whole document. Must return a valid file, never throw. */
  load(): CredentialsFile;
  /** Persist the whole document. */
  save(data: CredentialsFile): void;
}

/**
 * File-backed adapter. Lives at `<dataDir>/credentials.json` with `0o600`
 * permissions; writes are atomic (tmp + rename) and the dir is `0o700`.
 */
export class FileCredentialStorage implements CredentialStorageAdapter {
  readonly id: string;

  constructor(dataDir: string = path.join(os.homedir(), ".glorp")) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.id = path.join(dataDir, "credentials.json");
  }

  load(): CredentialsFile {
    if (!fs.existsSync(this.id)) return emptyCredentials();
    try {
      return normaliseCredentialsFile(JSON.parse(fs.readFileSync(this.id, "utf-8")));
    } catch {
      return emptyCredentials();
    }
  }

  save(data: CredentialsFile): void {
    const tmp = `${this.id}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, this.id);
    try {
      fs.chmodSync(this.id, 0o600);
    } catch {
      // best-effort permission tightening
    }
  }
}

let memorySeq = 0;

/** In-memory adapter — nothing touches disk. Each instance has a distinct id. */
export class MemoryCredentialStorage implements CredentialStorageAdapter {
  readonly id: string;
  private data: CredentialsFile;

  constructor(initial?: CredentialsFile) {
    this.id = `memory://credentials/${memorySeq++}`;
    this.data = initial ? structuredClone(initial) : emptyCredentials();
  }

  load(): CredentialsFile {
    return structuredClone(this.data);
  }

  save(data: CredentialsFile): void {
    this.data = structuredClone(data);
  }
}

/** Build the adapter named by `GARAGE_CREDENTIAL_STORAGE` (file | memory). */
export function credentialStorageFromEnv(dataDir?: string): CredentialStorageAdapter {
  const kind = process.env.GARAGE_CREDENTIAL_STORAGE?.toLowerCase();
  if (kind === "memory") return new MemoryCredentialStorage();
  return new FileCredentialStorage(dataDir);
}
