import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ModelInfo } from "./model-catalog.ts";

/**
 * Optional, file-backed configuration that the user controls directly.
 * Layered, from highest priority to lowest:
 *
 *   1. `<workspace>/glorp.json`
 *   2. `<workspace>/.glorp/config.json`
 *   3. `~/.config/glorp/config.json`
 *   4. `~/.glorp/config.json`
 *
 * Layers are shallow-merged — a key set in a higher layer wins entirely
 * over the same key in a lower layer (no per-field merging). String values
 * pass through `interpolate()` which expands `{env:VAR}` and `{file:PATH}`.
 *
 * The config is purely additive against credentials / the catalog. Nothing
 * in here is *required* for glorp to run.
 */
export interface ProjectConfig {
  /** Default model id, e.g. "anthropic/claude-opus-4-7". Currently informational. */
  model?: string;
  /** Cheap-model id for title generation, mirroring credentials.titleModel. */
  small_model?: string;
  /** Per-provider overrides keyed by provider id. */
  provider?: Record<string, ProviderOverride>;
}

export interface ProviderOverride {
  /** Display name override. */
  name?: string;
  /** Custom endpoint. Wins over credentials.baseURL for this provider id. */
  baseURL?: string;
  /** API key. `{env:VAR}` and `{file:PATH}` are interpolated. */
  apiKey?: string;
  /** Default context limit for any model this provider serves. */
  contextLimit?: number;
  /** Per-model overrides keyed by model id. */
  models?: Record<string, ModelOverride>;
}

export interface ModelOverride {
  /** Pretty name shown in the picker. */
  name?: string;
  /** Override the model's context window in tokens. Wins over catalog. */
  contextLimit?: number;
  /** Override the model's max output tokens. */
  outputLimit?: number;
  /** Per-million-token USD pricing. */
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  /** Capability declarations. Override anything the catalog reports. */
  tool_call?: boolean;
  attachment?: boolean;
  reasoning?: boolean;
  /**
   * Named overlays the user can cycle through in the picker. Each entry
   * stamps an alternate set of fields on top of the model — typically a
   * reasoning config. Picked variants are stored on the active profile so
   * the choice survives a restart.
   */
  variants?: Record<string, ModelVariant>;
}

export interface ModelVariant {
  /** Display label for this variant in the picker (defaults to the key). */
  label?: string;
  /**
   * Reasoning config to apply when this variant is active. The shape mirrors
   * `ReasoningConfig` from credentials.ts; we accept it loosely here so
   * config-file edits don't trip the discriminated union at parse time.
   */
  reasoning?: Record<string, unknown>;
  /** Override outputLimit just for this variant (e.g. "thinking" raises the cap). */
  outputLimit?: number;
}

/**
 * Load + merge every layer for the given workspace. Always returns a
 * value — empty when no files exist. Lookup is synchronous because the
 * caller (pickModel) is already async-friendly but doesn't need the wait.
 */
export function loadProjectConfig(workspace: string, homeDir: string = os.homedir()): ProjectConfig {
  const layers: ProjectConfig[] = [];
  const paths = [
    path.join(workspace, "glorp.json"),
    path.join(workspace, ".glorp", "config.json"),
    path.join(homeDir, ".config", "glorp", "config.json"),
    path.join(homeDir, ".glorp", "config.json"),
  ];
  for (const p of paths) {
    const layer = readLayer(p);
    if (layer) layers.push(layer);
  }
  return shallowMergeLayers(layers);
}

function readLayer(filePath: string): ProjectConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as ProjectConfig;
    return interpolateConfig(parsed);
  } catch (err) {
    console.error(`[glorp-config] failed to load ${filePath}:`, (err as Error).message);
    return null;
  }
}

/**
 * Merge in priority order: layers[0] wins over layers[1], etc. We do a
 * one-level deep merge so `provider.<id>` and `provider.<id>.models.<id>`
 * compose naturally — a user setting just `provider.anthropic.apiKey` in
 * the home layer and `provider.anthropic.contextLimit` in the workspace
 * layer should see both win.
 */
function shallowMergeLayers(layers: ProjectConfig[]): ProjectConfig {
  const merged: ProjectConfig = {};
  // Iterate lowest-priority first so higher layers overwrite.
  for (const layer of [...layers].reverse()) {
    if (layer.model !== undefined) merged.model = layer.model;
    if (layer.small_model !== undefined) merged.small_model = layer.small_model;
    if (layer.provider) {
      merged.provider ??= {};
      for (const [pid, providerOverride] of Object.entries(layer.provider)) {
        const existing = merged.provider[pid] ?? {};
        merged.provider[pid] = mergeProviderOverride(existing, providerOverride);
      }
    }
  }
  return merged;
}

function mergeProviderOverride(base: ProviderOverride, layer: ProviderOverride): ProviderOverride {
  const out: ProviderOverride = { ...base, ...layer };
  if (base.models || layer.models) {
    out.models = { ...(base.models ?? {}) };
    for (const [mid, modelOverride] of Object.entries(layer.models ?? {})) {
      const existing = out.models[mid] ?? {};
      out.models[mid] = mergeModelOverride(existing, modelOverride);
    }
  }
  return out;
}

function mergeModelOverride(base: ModelOverride, layer: ModelOverride): ModelOverride {
  const out: ModelOverride = { ...base, ...layer };
  if (base.cost || layer.cost) {
    out.cost = { ...(base.cost ?? {}), ...(layer.cost ?? {}) };
  }
  if (base.variants || layer.variants) {
    out.variants = { ...(base.variants ?? {}), ...(layer.variants ?? {}) };
  }
  return out;
}

/**
 * Walk a parsed config and run `interpolate()` on every string value. This
 * lets users keep secrets out of the JSON file by saying `"apiKey":
 * "{env:OPENAI_KEY}"` or `"apiKey": "{file:~/.secrets/openai}"`. Recurses
 * into objects and arrays.
 */
function interpolateConfig<T>(value: T): T {
  if (typeof value === "string") return interpolate(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => interpolateConfig(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateConfig(v);
    return out as unknown as T;
  }
  return value;
}

/**
 * Replace `{env:VAR}` with `process.env.VAR` (empty string if unset) and
 * `{file:PATH}` with the trimmed contents of PATH. PATH supports `~`
 * home expansion. Missing files become an empty string; we don't throw
 * because the caller already has a fallback chain.
 */
export function interpolate(input: string): string {
  return input.replace(/\{(env|file):([^}]+)\}/g, (_, kind, arg) => {
    if (kind === "env") return process.env[arg] ?? "";
    if (kind === "file") {
      const resolved = arg.startsWith("~")
        ? path.join(os.homedir(), arg.slice(1))
        : arg;
      try {
        return fs.readFileSync(resolved, "utf-8").trim();
      } catch {
        return "";
      }
    }
    return "";
  });
}

/**
 * Strip `//` line comments and `/* *​/` block comments so JSONC files load.
 * Naive but correct for what config files actually contain. Skips
 * matches inside string literals to avoid eating `"http://"`.
 */
function stripJsonComments(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  while (i < input.length) {
    const c = input[i]!;
    const next = input[i + 1];
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < input.length) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (c === stringQuote) inString = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      const nl = input.indexOf("\n", i);
      i = nl === -1 ? input.length : nl;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      i = end === -1 ? input.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Apply config overrides on top of a catalog ModelInfo. The user's values
 * always win. Returns a copy — never mutates the source. Used by the
 * picker (to compute the effective context window) and the UI (to render
 * the rich-column data with user-declared cost / capabilities).
 */
export function applyOverrides(
  info: ModelInfo | undefined,
  providerOverride: ProviderOverride | undefined,
  providerId: string,
  modelId: string,
): ModelInfo {
  const modelOverride = providerOverride?.models?.[modelId];
  const base: ModelInfo = info
    ? { ...info, cost: info.cost ? { ...info.cost } : undefined }
    : { providerId, id: modelId };
  if (modelOverride?.name) base.name = modelOverride.name;
  if (modelOverride?.contextLimit && modelOverride.contextLimit > 0) {
    base.context = modelOverride.contextLimit;
  } else if (providerOverride?.contextLimit && providerOverride.contextLimit > 0 && !base.context) {
    base.context = providerOverride.contextLimit;
  }
  if (modelOverride?.outputLimit && modelOverride.outputLimit > 0) base.output = modelOverride.outputLimit;
  if (modelOverride?.cost) base.cost = { ...(base.cost ?? {}), ...modelOverride.cost };
  if (modelOverride?.tool_call != null) base.tool_call = modelOverride.tool_call;
  if (modelOverride?.attachment != null) base.attachment = modelOverride.attachment;
  if (modelOverride?.reasoning != null) base.reasoning = modelOverride.reasoning;
  return base;
}

/** List declared variants for a (provider, model) pair, in declaration order. */
export function variantsFor(
  config: ProjectConfig,
  providerId: string,
  modelId: string,
): Array<{ name: string; variant: ModelVariant }> {
  const variants = config.provider?.[providerId]?.models?.[modelId]?.variants ?? {};
  return Object.entries(variants).map(([name, variant]) => ({ name, variant }));
}
