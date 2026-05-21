import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type KnownProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "groq"
  | "ollama";

export type ProviderId = KnownProvider | string; // "custom-<name>" for user-defined.

export interface KnownProviderMeta {
  id: KnownProvider;
  label: string;
  envVar: string;
  description: string;
  defaultModels: string[];
  needsApiKey: boolean;
  reasoningCapableModelMatchers: RegExp[];
}

export const KNOWN_PROVIDERS: KnownProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    description: "Claude — recommended for coding tasks",
    defaultModels: [
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514",
    ],
    needsApiKey: true,
    // Anthropic uses a different `thinking` config — not supported via reasoning effort here.
    reasoningCapableModelMatchers: [],
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    envVar: "OPENAI_API_KEY",
    description: "GPT-5, GPT-4.1, o-series",
    defaultModels: ["gpt-5", "gpt-4.1", "o4-mini", "o3", "o3-mini"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [/^gpt-5/, /^o[3-9]/, /^o\d+-mini/],
  },
  {
    id: "openrouter",
    label: "OpenRouter (any model)",
    envVar: "OPENROUTER_API_KEY",
    description: "Routed access to most models via one key",
    defaultModels: [
      "anthropic/claude-sonnet-4",
      "openai/gpt-5",
      "deepseek/deepseek-r1",
      "deepseek/deepseek-chat-v4",
      "qwen/qwen-2.5-72b-instruct",
      "x-ai/grok-2",
    ],
    needsApiKey: true,
    reasoningCapableModelMatchers: [
      /\/gpt-5/,
      /\/o[3-9]/,
      /\/deepseek-r1/,
      /\/deepseek-chat-v4/,
      /\/qwen.*thinking/,
      /\/glm-/,
      /\/kimi-/,
      /\/minimax/,
      /\/mimo/,
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    description: "Gemini 2.5 family",
    defaultModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [],
  },
  {
    id: "groq",
    label: "Groq (fast)",
    envVar: "GROQ_API_KEY",
    description: "Fast inference for Llama and DeepSeek-R1 distills",
    defaultModels: [
      "llama-3.3-70b-versatile",
      "deepseek-r1-distill-llama-70b",
      "qwen-2.5-coder-32b",
    ],
    needsApiKey: true,
    reasoningCapableModelMatchers: [/deepseek-r1/, /qwen.*coder/],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    envVar: "",
    description: "Local models — no API key needed",
    defaultModels: ["llama3.3", "qwen2.5-coder", "deepseek-r1"],
    needsApiKey: false,
    reasoningCapableModelMatchers: [/deepseek-r1/, /qwen.*thinking/],
  },
];

export function findKnownProvider(id: string): KnownProviderMeta | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === id);
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ProviderConfig {
  /** "known" if id matches a KnownProvider; "custom" if user-defined. */
  type: "known" | "custom";
  /** Display name for custom providers; matches KnownProvider.id for known ones. */
  id: string;
  /** Required for custom providers, optional for known (might use default URL). */
  baseURL?: string;
  /** API key. Optional for ollama and unauthenticated custom endpoints. */
  apiKey?: string;
}

export interface ModelProfile {
  /** Stable id used to identify the profile across sessions. */
  id: string;
  /** Human-readable label shown in the picker (e.g. "anthropic · sonnet"). */
  label: string;
  /** Provider id this profile uses (matches ProviderConfig.id). */
  providerId: string;
  /** Model name as the provider expects (e.g. "gpt-5", "claude-sonnet-4-20250514"). */
  model: string;
  /** Reasoning effort hint, for reasoning-capable models only. */
  reasoning?: ReasoningEffort;
  /** Timestamp of last use — drives default sort order. */
  lastUsedAt?: string;
}

export interface CredentialsFile {
  version: 1;
  providers: Record<string, ProviderConfig>;
  profiles: ModelProfile[];
  activeProfileId?: string;
}

const EMPTY: CredentialsFile = {
  version: 1,
  providers: {},
  profiles: [],
};

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
      // Light validation; if shape is wrong, fall back to empty rather than crash.
      if (parsed?.version !== 1 || typeof parsed.providers !== "object") {
        return structuredClone(EMPTY);
      }
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
    // Tighten existing files too.
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {}
  }

  hasAny(): boolean {
    return this.data.profiles.length > 0;
  }

  listProviders(): ProviderConfig[] {
    return Object.values(this.data.providers);
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.data.providers[id];
  }

  upsertProvider(p: ProviderConfig): void {
    this.data.providers[p.id] = p;
    this.flush();
  }

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

  getProfile(id: string): ModelProfile | undefined {
    return this.data.profiles.find((p) => p.id === id);
  }

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
    if (this.data.activeProfileId === id) {
      this.data.activeProfileId = this.data.profiles[0]?.id;
    }
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
  static makeProfileId(providerId: string, model: string, reasoning?: ReasoningEffort): string {
    const r = reasoning ? `-${reasoning}` : "";
    return `${providerId}__${model}${r}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  }
}

/** Does the given (provider, model) combo accept a reasoning effort hint? */
export function modelAcceptsReasoning(providerId: string, model: string): boolean {
  const known = findKnownProvider(providerId);
  if (known) {
    return known.reasoningCapableModelMatchers.some((re) => re.test(model));
  }
  // Custom providers: assume yes if the model name matches common reasoning patterns.
  return /gpt-5|^o[3-9]|deepseek-r1|deepseek-chat-v4|glm-|kimi-|minimax|mimo|qwen.*thinking/.test(
    model,
  );
}
