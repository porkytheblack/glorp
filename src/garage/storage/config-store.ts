/**
 * Persists the garage-global remote-storage configuration at
 * `<dataDir>/storage.json` (0600 — it holds the bucket secret). The secret is
 * write-only through the API: DTOs report `has_secret` and omit the value.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { StorageConfig } from "./types.ts";

const FILE = "storage.json";

export class StorageConfigStore {
  private readonly file: string;
  private config: StorageConfig;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, FILE);
    this.config = this.load();
  }

  get(): StorageConfig {
    return this.config;
  }

  /** Merge a partial update; an omitted secret keeps the stored one. */
  update(patch: Partial<StorageConfig>): StorageConfig {
    const next: StorageConfig = { ...this.config, ...patch };
    if (patch.secretAccessKey === undefined) next.secretAccessKey = this.config.secretAccessKey;
    // Normalize: empty strings mean "unset".
    for (const k of ["endpoint", "bucket", "accessKeyId", "secretAccessKey", "prefix"] as const) {
      if (next[k] === "") delete next[k];
    }
    if (next.prefix) next.prefix = next.prefix.replace(/^\/+|\/+$/g, "");
    this.config = next;
    this.save();
    return next;
  }

  /** Secret-free wire view. */
  dto(): {
    enabled: boolean;
    endpoint: string | null;
    bucket: string | null;
    prefix: string | null;
    access_key_id: string | null;
    has_secret: boolean;
  } {
    const c = this.config;
    return {
      enabled: c.enabled,
      endpoint: c.endpoint ?? null,
      bucket: c.bucket ?? null,
      prefix: c.prefix ?? null,
      access_key_id: c.accessKeyId ?? null,
      has_secret: Boolean(c.secretAccessKey),
    };
  }

  /** True when every field needed to reach the bucket is present. */
  usable(): boolean {
    const c = this.config;
    return Boolean(c.enabled && c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey);
  }

  private load(): StorageConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf-8")) as Partial<StorageConfig>;
      return { enabled: Boolean(raw.enabled), ...raw } as StorageConfig;
    } catch {
      return { enabled: false };
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
