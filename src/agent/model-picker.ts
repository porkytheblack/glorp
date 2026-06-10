import type { ModelAdapter } from "glove-core/core";
import type {
  CredentialsStore,
  ModelProfile,
  ProviderConfig,
  ReasoningConfig,
} from "./credentials.ts";
import {
  effectiveProviderId,
  findKnownProvider,
  modelAcceptsReasoning,
  normaliseReasoning,
  reasoningLabel,
} from "./credentials.ts";
import { DEFAULT_FALLBACK_CONTEXT_LIMIT, ModelCatalog, type ModelInfo } from "./model-catalog.ts";
import {
  applyOverrides,
  variantsFor,
  type ModelVariant,
  type ProjectConfig,
  type ProviderOverride,
} from "./project-config.ts";

/**
 * Per-provider default for the title-generation model. Picked to be cheap
 * and fast — title gen is a single short prompt and doesn't need a
 * reasoning model. Falls back to the main model when no entry matches or
 * when the profile sets its own `titleModel`.
 */
const CHEAP_TITLE_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4.1-mini",
  openrouter: "anthropic/claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  mimo: "mimo-v2.5",
};

/** Default output-token budget for the main agent — generous for coding tasks. */
const DEFAULT_MAX_TOKENS = 32_768;
/** Title generation is a single short summary — keep the budget tight. */
const TITLE_MAX_TOKENS = 1024;

/**
 * Hard ceiling for the auto-resolved output budget. Some catalog entries
 * advertise an output limit at (or near) the full context window — e.g.
 * `512000` of a `524288`-token window — so reserving it verbatim leaves almost
 * nothing for input + tool schemas and 400s the turn before any output is
 * produced. We cap the auto-pick so input always has room; operators who
 * genuinely need more can raise it with `GLORP_MAX_OUTPUT_TOKENS`.
 */
const MAX_AUTO_OUTPUT_TOKENS = 32_768;

/**
 * The most of the context window the output budget may claim, leaving the rest
 * for input + tool schemas. Applied even to an explicit `GLORP_MAX_OUTPUT_TOKENS`
 * so a turn degrades (shorter completion) instead of hard-400-ing on input.
 */
const MAX_OUTPUT_CONTEXT_FRACTION = 0.5;

export interface PickModelOptions {
  /** Explicit provider id from CLI flags. Takes precedence over everything else. */
  provider?: string;
  /** Explicit model from CLI flags. */
  model?: string;
  /** Credentials store — consulted when CLI flags + env are absent. */
  credentials?: CredentialsStore;
  /** Profile id to use from the credentials store (overrides activeProfileId). */
  profileId?: string;
  /** Model catalog used to resolve `contextLimit`. Optional; falls back to default when absent. */
  catalog?: ModelCatalog;
  /** Project config (glorp.json) overrides. Optional; merged on top of catalog. */
  projectConfig?: ProjectConfig;
}

export interface PickedModel {
  adapter: ModelAdapter;
  /** Label suitable for the TUI status bar (e.g. "anthropic · sonnet"). */
  label: string;
  /** The provider id this adapter is targeting. */
  providerId: string;
  /** The model name passed to the adapter. */
  model: string;
  /** The profile that drove this pick, if any. */
  profile?: ModelProfile;
  /**
   * Resolved input-context window in tokens. Resolution order:
   *   1. `profile.contextLimit` override
   *   2. `provider.contextLimit` (credentials.json)
   *   3. `projectConfig` overrides (glorp.json model.contextLimit / provider.contextLimit)
   *   4. `catalog.getContextLimit(providerId, model)`
   *   5. {@link DEFAULT_FALLBACK_CONTEXT_LIMIT}
   */
  contextLimit: number;
  /**
   * Resolved output-token budget passed to the adapter (`maxTokens`). Clamped
   * so it never crowds out the input window — see {@link resolveMaxTokens}.
   */
  maxOutputTokens: number;
  /** Resolved capability / pricing record. Used by the rich-column picker UI. */
  modelInfo?: ModelInfo;
  /**
   * Cheap adapter used by the title scheduler. Same provider config as the
   * main adapter; only the model name differs. Falls back to `adapter`
   * when no cheap alternative applies. Resolution order:
   *   1. `profile.titleModel` override
   *   2. {@link CHEAP_TITLE_MODELS} for the effective provider
   *   3. main adapter (no separate title model)
   */
  titleAdapter: ModelAdapter;
}

/**
 * Resolve a usable ModelAdapter from (in order):
 *   1. CLI flags (`--provider X --model Y`)
 *   2. A specific profile id (`opts.profileId`) from the credentials store
 *   3. The active profile in the credentials store
 *   4. Env vars (legacy behavior — backward compat)
 *
 * Returns the adapter + a label + the resolved provider/model. The caller
 * decides what to do with the label (e.g. show it in the status bar).
 */
export async function pickModel(opts: PickModelOptions): Promise<PickedModel> {
  // 1. Explicit CLI flags.
  if (opts.provider) {
    const model = opts.model ?? defaultModelFor(opts.provider);
    const info = resolveModelInfo({
      providerId: opts.provider, model,
      catalog: opts.catalog, projectConfig: opts.projectConfig,
    });
    const maxOutputTokens = resolveMaxTokens(info);
    const adapter = await buildAdapter({
      providerId: opts.provider, model, maxTokens: maxOutputTokens,
    });
    const titleAdapter = await buildTitleAdapter({
      providerId: opts.provider, mainAdapter: adapter,
    });
    return {
      adapter, titleAdapter,
      label: labelFor(opts.provider, model),
      providerId: opts.provider, model, modelInfo: info,
      contextLimit: resolveContextLimit({ info }), maxOutputTokens,
    };
  }

  // 2. A specific profile from the credentials store.
  if (opts.credentials) {
    let profile: ModelProfile | undefined;
    if (opts.profileId) profile = opts.credentials.getProfile(opts.profileId);
    else profile = opts.credentials.getActiveProfile();
    if (profile) {
      const provider = opts.credentials.getProvider(profile.providerId);
      const activeVariant = pickActiveVariant(opts.projectConfig, profile);
      const reasoning =
        activeVariant?.variant.reasoning
          ? normaliseReasoning(activeVariant.variant.reasoning as ReasoningConfig)
          : normaliseReasoning(profile.reasoning);
      let info = resolveModelInfo({
        providerId: profile.providerId, model: profile.model, provider,
        catalog: opts.catalog, projectConfig: opts.projectConfig,
      });
      if (activeVariant?.variant.outputLimit) {
        info = { ...info, output: activeVariant.variant.outputLimit };
      }
      // A variant's outputLimit is a deliberate operator choice — let it bypass
      // the catalog auto-ceiling (still clamped to the context window below).
      const maxOutputTokens = resolveMaxTokens(info, activeVariant?.variant.outputLimit);
      const adapter = await buildAdapter({
        providerId: profile.providerId, model: profile.model,
        reasoning, provider, maxTokens: maxOutputTokens,
      });
      const titleAdapter = await buildTitleAdapter({
        providerId: profile.providerId, provider, profile, mainAdapter: adapter,
      });
      return {
        adapter, titleAdapter,
        label: labelFor(profile.providerId, profile.model, reasoning, activeVariant?.name),
        providerId: profile.providerId, model: profile.model, profile, modelInfo: info,
        contextLimit: resolveContextLimit({ profile, provider, info }), maxOutputTokens,
      };
    }
  }

  // 3. Env-var fallback.
  const envProvider = envDetectedProvider();
  if (envProvider) {
    const model = defaultModelFor(envProvider);
    const info = resolveModelInfo({
      providerId: envProvider, model, catalog: opts.catalog, projectConfig: opts.projectConfig,
    });
    const maxOutputTokens = resolveMaxTokens(info);
    const adapter = await buildAdapter({
      providerId: envProvider, maxTokens: maxOutputTokens,
    });
    const titleAdapter = await buildTitleAdapter({
      providerId: envProvider, mainAdapter: adapter,
    });
    return {
      adapter, titleAdapter,
      label: labelFor(envProvider, model),
      providerId: envProvider, model, modelInfo: info,
      contextLimit: resolveContextLimit({ info }), maxOutputTokens,
    };
  }

  throw new Error(
    "No model configured. Run `glorp` interactively to onboard, set an API key env var, or pass --provider/--model.",
  );
}

/**
 * Build the title-generation adapter. Picks (in order) `profile.titleModel`,
 * a per-provider cheap default from {@link CHEAP_TITLE_MODELS}, and finally
 * the main adapter itself when no cheaper alternative is available.
 */
async function buildTitleAdapter(args: {
  providerId: string;
  provider?: ProviderConfig;
  profile?: ModelProfile;
  mainAdapter: ModelAdapter;
}): Promise<ModelAdapter> {
  const effectiveId = effectiveProviderId(args.providerId, args.provider);
  const titleModel = args.profile?.titleModel ?? CHEAP_TITLE_MODELS[effectiveId];
  if (!titleModel) return args.mainAdapter;
  try {
    return await buildAdapter({
      providerId: args.providerId,
      model: titleModel,
      provider: args.provider,
      maxTokens: TITLE_MAX_TOKENS,
    });
  } catch {
    return args.mainAdapter;
  }
}

/**
 * Resolution order, most specific first:
 *   1. `profile.contextLimit`           — per-model override (credentials.json)
 *   2. `provider.contextLimit`          — per-endpoint override (credentials.json)
 *   3. `info.context` from project config + catalog (glorp.json model.contextLimit,
 *                                          glorp.json provider.contextLimit, or the
 *                                          catalog entry — `applyOverrides` already
 *                                          consumed both layers)
 *   4. {@link DEFAULT_FALLBACK_CONTEXT_LIMIT} — last-resort 128k
 */
function resolveContextLimit(args: {
  profile?: ModelProfile;
  provider?: ProviderConfig;
  info?: ModelInfo;
}): number {
  if (args.profile?.contextLimit && args.profile.contextLimit > 0) return args.profile.contextLimit;
  if (args.provider?.contextLimit && args.provider.contextLimit > 0) return args.provider.contextLimit;
  if (args.info?.context && args.info.context > 0) return args.info.context;
  return DEFAULT_FALLBACK_CONTEXT_LIMIT;
}

/**
 * Resolve the output-token budget for the main agent, clamped so it never
 * crowds out the input window. The chosen budget is, in order:
 *   1. `GLORP_MAX_OUTPUT_TOKENS` env override (operator lever), else
 *   2. an explicit `outputLimit` from config (e.g. a "thinking" variant that
 *      deliberately raises the cap), else
 *   3. the catalog's advertised output limit, else {@link DEFAULT_MAX_TOKENS},
 *      capped at {@link MAX_AUTO_OUTPUT_TOKENS}.
 * Only the catalog default (3) gets the low auto-ceiling — explicit operator
 * choices (1, 2) are trusted. The result is then clamped to
 * {@link MAX_OUTPUT_CONTEXT_FRACTION} of the context window when known, so a
 * turn always degrades (shorter completion) instead of hard-400-ing on input.
 */
function resolveMaxTokens(info?: ModelInfo, explicitOutput?: number): number {
  const envCap = envMaxOutputTokens();
  const explicit = explicitOutput && explicitOutput > 0 ? explicitOutput : undefined;
  const advertised = info?.output && info.output > 0 ? info.output : DEFAULT_MAX_TOKENS;
  let out = envCap ?? explicit ?? Math.min(advertised, MAX_AUTO_OUTPUT_TOKENS);
  const context = info?.context && info.context > 0 ? info.context : undefined;
  if (context) out = Math.min(out, Math.floor(context * MAX_OUTPUT_CONTEXT_FRACTION));
  return Math.max(out, 1);
}

/** Parse a positive integer from `GLORP_MAX_OUTPUT_TOKENS`, or undefined when unset/invalid. */
function envMaxOutputTokens(): number | undefined {
  const raw = process.env.GLORP_MAX_OUTPUT_TOKENS;
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Build the merged ModelInfo the picker (and the UI) should use:
 *   start from the catalog entry → overlay glorp.json provider/model overrides.
 * Returns at least a stub `{ providerId, id }` so the picker has somewhere
 * to attach values even when the catalog is empty.
 *
 * Catalog lookups go through `effectiveProviderId(...)` so a custom
 * provider whose `adapter: "mimo"` / `basedOn: "mimo"` (or the MiMo URL
 * heuristic) actually finds the MiMo entries — without this, the catalog
 * is queried with the raw `custom-xiaomi-mimo` id and silently misses.
 * Project-config overrides still key on the raw provider id so users
 * declare overrides against the name they actually have in credentials.
 */
function resolveModelInfo(args: {
  providerId: string;
  model: string;
  provider?: ProviderConfig;
  catalog?: ModelCatalog;
  projectConfig?: ProjectConfig;
}): ModelInfo {
  const effective = effectiveProviderId(args.providerId, args.provider, args.model);
  const fromCatalog = args.catalog?.getModelInfo(effective, args.model);
  const providerOverride: ProviderOverride | undefined =
    args.projectConfig?.provider?.[args.providerId] ??
    args.projectConfig?.provider?.[effective];
  return applyOverrides(fromCatalog, providerOverride, args.providerId, args.model);
}

/**
 * Build a ModelAdapter for the given provider config. Adapters are imported
 * lazily to avoid loading Bedrock's broken transitive deps. The reasoning
 * config (when present and supported) is translated into the right adapter
 * options shape per provider.
 */
async function buildAdapter(args: {
  providerId: string;
  model?: string;
  reasoning?: ReasoningConfig;
  /** Provider config from credentials store, when available. */
  provider?: ProviderConfig;
  /** Output-token budget. Resolved from catalog output limit or {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
}): Promise<ModelAdapter> {
  const { providerId, model: modelArg, reasoning, provider } = args;
  const effectiveId = effectiveProviderId(providerId, provider);
  const known = findKnownProvider(effectiveId);
  const apiKey = provider?.apiKey ?? (known ? process.env[known.envVar] : undefined);
  const baseURL = provider?.baseURL;
  const model = modelArg ?? defaultModelFor(effectiveId);

  // Anthropic — native and custom `basedOn: "anthropic"` endpoints.
  if (effectiveId === "anthropic") {
    const { AnthropicAdapter } = await import("glove-core/models/anthropic");
    return new AnthropicAdapter({
      apiKey,
      model,
      stream: true,
      maxTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  // Xiaomi MiMo: dedicated adapter handles reasoning_content + larger
  // default completion budget. Fires for native `mimo`, `basedOn: "mimo"`,
  // explicit `adapter: "mimo"`, or a heuristic on the URL/model name.
  const isCustomMimoHeuristic =
    provider?.type === "custom" &&
    provider.basedOn == null &&
    provider.adapter == null &&
    (/xiaomimimo\.com/i.test(baseURL ?? "") || /^mimo(?:-|$)/i.test(model));
  if (effectiveId === "mimo" || isCustomMimoHeuristic) {
    const { MimoAdapter } = await import("glove-core/models/mimo");
    const effort =
      reasoning?.kind === "effort" && reasoning.effort !== "minimal"
        ? reasoning.effort
        : undefined;
    return new MimoAdapter({
      apiKey,
      model,
      stream: true,
      maxTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(baseURL ? { baseURL } : {}),
      ...(effort ? { reasoningEffort: effort } : {}),
    });
  }

  // OpenAI-compat (openai, openrouter, gemini, groq, ollama, custom).
  const { OpenAICompatAdapter } = await import("glove-core/models/openai-compat");
  const compatOpts: any = {
    apiKey: apiKey ?? (effectiveId === "ollama" ? "ollama" : ""),
    baseURL: baseURL ?? defaultBaseURLFor(effectiveId),
    model,
    stream: true,
    maxTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  const reasoningCapable = modelAcceptsReasoning(effectiveId, model);
  if (reasoning && reasoning.kind !== "off" && reasoningCapable) {
    compatOpts.reasoning = translateReasoning(reasoning);
  } else if (reasoningCapable) {
    // Reasoning-capable models (kimi-k2.6, deepseek-chat-v4, …) think by
    // default server-side. Without capture+echo the provider rejects the
    // first multi-turn tool loop ("reasoning_content is missing in assistant
    // tool call message") — so even profiles with no explicit reasoning get
    // capture+echo, just no effort hint. DeepSeek-R1 is the documented
    // exception: it rejects echoed reasoning, so capture only.
    compatOpts.reasoning = { echo: !/deepseek-r1/i.test(model) };
  }
  return new OpenAICompatAdapter(compatOpts);
}

/**
 * Map our typed `ReasoningConfig` to the shape the OpenAI-compat adapter
 * expects (per glove-core/models/openai-compat). The structured options
 * pass straight through; we just rename `qwenThinking` into the adapter's
 * `extraBody` form documented for Qwen3 dashscope.
 */
function translateReasoning(r: ReasoningConfig): Record<string, unknown> {
  switch (r.kind) {
    case "off":
      return {};
    case "effort":
      return { effort: r.effort };
    case "thinking":
      // Adapter accepts Anthropic-style `thinking` even on OpenAI-compat
      // endpoints that proxy Anthropic (e.g. some OpenRouter routes).
      return { thinking: { type: "enabled", budget_tokens: r.budget_tokens } };
    case "reasoningObject":
      return {
        reasoningObject: r.max_tokens
          ? { effort: r.effort, max_tokens: r.max_tokens }
          : { effort: r.effort },
      };
    case "qwenThinking":
      return {
        extraBody: {
          enable_thinking: r.enabled,
          ...(r.budget_tokens != null ? { thinking_budget: r.budget_tokens } : {}),
        },
      };
  }
}

function defaultModelFor(providerId: string): string {
  const known = findKnownProvider(providerId);
  return known?.defaultModels[0] ?? "gpt-4.1";
}

/** Default REST base URL per provider. Exported for the Garage's live
 * model-listing endpoint, which needs the same resolution outside an adapter. */
export function defaultBaseURLFor(providerId: string): string {
  switch (providerId) {
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai/";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "mimo":
      return "https://api.xiaomimimo.com/v1";
    case "ollama":
      return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
    default:
      return process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  }
}

function envDetectedProvider(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.MIMO_API_KEY) return "mimo";
  return undefined;
}

function labelFor(
  providerId: string,
  model: string,
  reasoning?: ReasoningConfig,
  variantName?: string,
): string {
  const known = findKnownProvider(providerId);
  const prefix = known?.id ?? providerId;
  const r = reasoning && reasoning.kind !== "off" ? ` · ${reasoningLabel(reasoning)}` : "";
  const v = variantName ? ` · ${variantName}` : "";
  return `${prefix} · ${shortModel(model)}${v}${r}`;
}

/**
 * Resolve `profile.variantName` against the variants declared for the
 * (providerId, model) in `projectConfig`. Returns `null` when the profile
 * has no active variant, or when the named variant has been removed
 * since the user last switched (falls back to the profile's own reasoning).
 */
function pickActiveVariant(
  projectConfig: ProjectConfig | undefined,
  profile: ModelProfile,
): { name: string; variant: ModelVariant } | null {
  if (!projectConfig || !profile.variantName) return null;
  const variants = variantsFor(projectConfig, profile.providerId, profile.model);
  const hit = variants.find((v) => v.name === profile.variantName);
  return hit ?? null;
}

function shortModel(model: string): string {
  const slash = model.lastIndexOf("/");
  let s = slash >= 0 ? model.slice(slash + 1) : model;
  s = s.replace(/-\d{8}$/, "");
  return s;
}
