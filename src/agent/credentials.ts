import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type KnownProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "groq"
  | "mimo"
  | "ollama";

export type ProviderId = KnownProvider | string; // "custom-<name>" for user-defined.

export const CUSTOM_PROVIDER_ADAPTERS = [
  {
    id: "openai-compat",
    label: "OpenAI-compatible",
    description: "Generic /v1/chat/completions endpoint",
  },
  {
    id: "mimo",
    label: "Xiaomi MiMo",
    description: "MiMo reasoning_content adapter",
  },
] as const;

export type CustomProviderAdapter = (typeof CUSTOM_PROVIDER_ADAPTERS)[number]["id"];

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
    id: "mimo",
    label: "Xiaomi MiMo",
    envVar: "MIMO_API_KEY",
    description: "Xiaomi MiMo reasoning models",
    defaultModels: ["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2-pro", "mimo-v2-omni"],
    needsApiKey: true,
    reasoningCapableModelMatchers: [/^mimo/],
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

export function reasoningProviderId(providerId: string, provider?: ProviderConfig): string {
  if (provider?.type === "custom" && provider.adapter === "mimo") return "mimo";
  return providerId;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Provider-specific "thinking" configuration. Different providers expose
 * different controls — Glove's adapter contracts in
 * `glove-core/models/openai-compat` reflect this directly:
 *
 *   - `effort`           — OpenAI GPT-5 / o-series, GLM, Kimi, MiniMax,
 *                          DeepSeek V4, Groq DeepSeek-R1 distill
 *   - `thinking`         — Anthropic-style budget tokens (1024-32768)
 *   - `reasoningObject`  — OpenRouter unified shape (effort + max_tokens)
 *   - `qwenThinking`     — Qwen3 dashscope (enable_thinking + budget)
 *
 * `kind: "off"` means "let the model decide" (no hint sent).
 */
export type ReasoningConfig =
  | { kind: "off" }
  | { kind: "effort"; effort: ReasoningEffort }
  | { kind: "thinking"; budget_tokens: number }
  | {
      kind: "reasoningObject";
      effort: Exclude<ReasoningEffort, "minimal">;
      max_tokens?: number;
    }
  | { kind: "qwenThinking"; enabled: boolean; budget_tokens?: number };

export interface ProviderConfig {
  /** "known" if id matches a KnownProvider; "custom" if user-defined. */
  type: "known" | "custom";
  /** Display name for custom providers; matches KnownProvider.id for known ones. */
  id: string;
  /** Adapter implementation used for custom endpoints. Defaults to OpenAI-compatible. */
  adapter?: CustomProviderAdapter;
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
  /**
   * Thinking-mode config. Provider-specific shape; see ReasoningConfig.
   * Legacy field: may also be a bare ReasoningEffort string from older
   * credentials files — `normaliseReasoning` upgrades it on read.
   */
  reasoning?: ReasoningConfig | ReasoningEffort;
  /** Timestamp of last use — drives default sort order. */
  lastUsedAt?: string;
  /**
   * Override the context window size (in tokens) for this profile. Wins over
   * whatever the model catalog reports. Useful for custom endpoints whose
   * model name doesn't match any cataloged entry.
   */
  contextLimit?: number;
}

/** Upgrade old bare-effort strings on disk to the discriminated union. */
export function normaliseReasoning(r: ModelProfile["reasoning"]): ReasoningConfig {
  if (!r) return { kind: "off" };
  if (typeof r === "string") return { kind: "effort", effort: r };
  return r;
}

/** Human-readable label for a reasoning config (for the status bar / picker). */
export function reasoningLabel(r: ReasoningConfig): string {
  switch (r.kind) {
    case "off":
      return "off";
    case "effort":
      return r.effort;
    case "thinking":
      return `${r.budget_tokens} budget`;
    case "reasoningObject":
      return r.max_tokens ? `${r.effort} · ${r.max_tokens}` : r.effort;
    case "qwenThinking":
      return r.enabled
        ? r.budget_tokens
          ? `on · ${r.budget_tokens} budget`
          : "on"
        : "off";
  }
}

/** Reasoning kinds that mean "thinking is enabled" (i.e. not "off"). */
export type ActiveReasoningKind = "effort" | "thinking" | "reasoningObject" | "qwenThinking";

/**
 * Which kind of reasoning config is appropriate for a given provider+model.
 * Returns null when the model doesn't accept any reasoning hint. The "off"
 * kind is universal so it isn't surfaced here — every options list
 * includes "off" as an entry regardless of model.
 */
export function reasoningKindFor(
  providerId: string,
  model: string,
): ActiveReasoningKind | null {
  if (!modelAcceptsReasoning(providerId, model)) return null;
  if (providerId === "anthropic") return "thinking";
  if (providerId === "mimo") return "effort";
  if (providerId === "openrouter") {
    // OpenRouter's unified `reasoning` object — works across deepseek-r1,
    // gpt-5 routed through openrouter, etc.
    return "reasoningObject";
  }
  if (/^qwen3/.test(model) || /\/qwen3/.test(model)) return "qwenThinking";
  // openai gpt-5/o-series, groq deepseek-r1, gemini fallback, custom — all
  // use the effort enum.
  return "effort";
}

/**
 * Produce a list of options the UI can show in a picker for a model. The
 * first option is always "off". For effort-kind models, the list reflects
 * the provider's supported levels (minimal is GPT-5-only).
 */
export interface ReasoningOption {
  label: string;
  description?: string;
  value: ReasoningConfig;
}

export function reasoningOptionsFor(
  providerId: string,
  model: string,
): ReasoningOption[] {
  const kind = reasoningKindFor(providerId, model);
  const off: ReasoningOption = {
    label: "off — let the model decide",
    value: { kind: "off" },
  };
  if (kind === null) return [];
  switch (kind) {
    case "effort": {
      const supportsMinimal = providerId === "openai" && /^gpt-5/.test(model);
      const opts: ReasoningOption[] = [off];
      if (supportsMinimal) {
        opts.push({
          label: "minimal",
          description: "GPT-5 only — least thinking",
          value: { kind: "effort", effort: "minimal" },
        });
      }
      opts.push(
        { label: "low", description: "fast, lighter reasoning", value: { kind: "effort", effort: "low" } },
        { label: "medium", description: "balanced", value: { kind: "effort", effort: "medium" } },
        {
          label: "high (recommended for reasoning models)",
          description: "deep reasoning",
          value: { kind: "effort", effort: "high" },
        },
      );
      return opts;
    }
    case "thinking": {
      return [
        off,
        { label: "1k budget", description: "lightweight thinking", value: { kind: "thinking", budget_tokens: 1024 } },
        { label: "4k budget", description: "moderate (recommended)", value: { kind: "thinking", budget_tokens: 4096 } },
        { label: "16k budget", description: "deep thinking", value: { kind: "thinking", budget_tokens: 16384 } },
        { label: "32k budget", description: "max — slow and expensive", value: { kind: "thinking", budget_tokens: 32768 } },
      ];
    }
    case "reasoningObject": {
      return [
        off,
        { label: "low", description: "fast OpenRouter route", value: { kind: "reasoningObject", effort: "low" } },
        { label: "medium", value: { kind: "reasoningObject", effort: "medium" } },
        { label: "high (recommended)", value: { kind: "reasoningObject", effort: "high" } },
        { label: "high · 4k cap", value: { kind: "reasoningObject", effort: "high", max_tokens: 4000 } },
        { label: "high · 16k cap", value: { kind: "reasoningObject", effort: "high", max_tokens: 16000 } },
      ];
    }
    case "qwenThinking": {
      return [
        off,
        { label: "on (auto budget)", description: "dashscope enable_thinking", value: { kind: "qwenThinking", enabled: true } },
        { label: "on · 1k budget", value: { kind: "qwenThinking", enabled: true, budget_tokens: 1024 } },
        { label: "on · 4k budget", value: { kind: "qwenThinking", enabled: true, budget_tokens: 4096 } },
      ];
    }
    default: {
      // Exhaustiveness: every kind above must return; the assertion makes
      // adding a new ReasoningConfig variant a compile error here.
      const _exhaustive: never = kind;
      return [_exhaustive];
    }
  }
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
