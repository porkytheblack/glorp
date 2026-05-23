import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProviderConfig } from "./providers.ts";
import { normaliseReasoning, type ReasoningConfig, type ReasoningEffort } from "./reasoning.ts";

export interface ModelProfile {
  id: string;
  label: string;
  providerId: string;
  model: string;
  reasoning?: ReasoningConfig | ReasoningEffort;
  lastUsedAt?: string;
}

export interface CredentialsFile {
  version: 1;
  providers: Record<string, ProviderConfig>;
  profiles: ModelProfile[];
  activeProfileId?: string;
}

const EMPTY: CredentialsFile = { version: 1, providers: {}, profiles: [] };

/**
 * File-backed credentials store. Lives at `<dataDir>/credentials.json` with
 * `0o600` permissions. Writes are atomic (tmp + rename) and the parent dir
 * is created with `0o700`.
 */
export class CredentialsStore {
  filePath: string;
  private data: CredentialsFile;

  constructor(dataDir: string = path.join(os.homedir(), ".glorp")) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.filePath = path.join(dataDir, "credentials.json");
    this.data = this.loadFromDisk();
  }

  private loadFromDisk(): CredentialsFile {
    if (!fs.existsSync(this.filePath)) return structuredClone(EMPTY);
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as CredentialsFile;
      if (parsed?.version !== 1 || typeof parsed.providers !== "object") return structuredClone(EMPTY);
      return {
        version: 1,
        providers: parsed.providers,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        activeProfileId: parsed.activeProfileId,
      };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  private flush(): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }

  hasAny(): boolean { return this.data.profiles.length > 0; }
  listProviders(): ProviderConfig[] { return Object.values(this.data.providers); }
  getProvider(id: string): ProviderConfig | undefined { return this.data.providers[id]; }
  upsertProvider(p: ProviderConfig): void { this.data.providers[p.id] = p; this.flush(); }

  removeProvider(id: string): void {
    delete this.data.providers[id];
    this.data.profiles = this.data.profiles.filter((pr) => pr.providerId !== id);
    if (this.data.activeProfileId && !this.data.profiles.find((p) => p.id === this.data.activeProfileId)) {
      this.data.activeProfileId = this.data.profiles[0]?.id;
    }
    this.flush();
  }

  listProfiles(): ModelProfile[] {
    return [...this.data.profiles].sort((a, b) => {
      const at = a.lastUsedAt ?? "";
      const bt = b.lastUsedAt ?? "";
      if (a.id === this.data.activeProfileId) return -1;
      if (b.id === this.data.activeProfileId) return 1;
      return bt.localeCompare(at);
    });
  }
  getProfile(id: string): ModelProfile | undefined { return this.data.profiles.find((p) => p.id === id); }
  getActiveProfile(): ModelProfile | undefined {
    if (this.data.activeProfileId) return this.getProfile(this.data.activeProfileId);
    return this.data.profiles[0];
  }
  upsertProfile(p: ModelProfile): void {
    const idx = this.data.profiles.findIndex((x) => x.id === p.id);
    if (idx >= 0) this.data.profiles[idx] = p;
    else this.data.profiles.push(p);
    this.flush();
  }
  removeProfile(id: string): void {
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    if (this.data.activeProfileId === id) this.data.activeProfileId = this.data.profiles[0]?.id;
    this.flush();
  }
  setActive(id: string): void {
    if (!this.getProfile(id)) throw new Error(`Unknown profile id: ${id}`);
    this.data.activeProfileId = id;
    const p = this.getProfile(id)!;
    p.lastUsedAt = new Date().toISOString();
    this.flush();
  }

  /** Build a stable profile id from provider + model + optional reasoning. */
  static makeProfileId(
    providerId: string,
    model: string,
    reasoning?: ReasoningConfig | ReasoningEffort,
  ): string {
    const norm = normaliseReasoning(reasoning);
    let suffix = "";
    if (norm.kind === "effort") suffix = `-${norm.effort}`;
    else if (norm.kind === "thinking") suffix = `-think${norm.budget_tokens}`;
    else if (norm.kind === "reasoningObject")
      suffix = `-${norm.effort}${norm.max_tokens ? `-${norm.max_tokens}` : ""}`;
    else if (norm.kind === "qwenThinking")
      suffix = `-qwen${norm.enabled ? norm.budget_tokens ?? "on" : "off"}`;
    return `${providerId}__${model}${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  }
}
