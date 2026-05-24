import * as fs from "node:fs";
import * as path from "node:path";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export const DEFAULT_FALLBACK_CONTEXT_LIMIT = 128_000;

/**
 * Per-million-token prices in USD as returned by models.dev. `cache_read`
 * and `cache_write` are nullable because not every model supports the
 * cache pricing fields.
 */
export interface ModelCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface ModelModalities {
  input: string[];
  output: string[];
}

/**
 * Capability + pricing record for a single (provider, model) pair, as
 * sourced from models.dev. Fields we don't care about today are dropped
 * here intentionally — we can re-extract them when needed. `name` is the
 * human-readable label ("OpenAI GPT-4o"); `id` is the wire id ("gpt-4o").
 */
export interface ModelInfo {
  providerId: string;
  id: string;
  name?: string;
  family?: string;
  context?: number;
  output?: number;
  cost?: ModelCost;
  modalities?: ModelModalities;
  tool_call?: boolean;
  attachment?: boolean;
  reasoning?: boolean;
  knowledge?: string;
  release_date?: string;
}

interface RawModelEntry {
  id?: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  modalities?: ModelModalities;
  limit?: { context?: number; output?: number };
  cost?: ModelCost;
}

interface RawProviderEntry {
  id?: string;
  name?: string;
  models?: Record<string, RawModelEntry>;
}

type RawModelsDevPayload = Record<string, RawProviderEntry>;

interface CacheFile {
  fetched_at: number;
  source: string;
  /** Flat index of "<providerId>/<modelId>" → ModelInfo for fast lookup. */
  entries: Record<string, ModelInfo>;
}

/**
 * Disk-cached lookup of model metadata, sourced from models.dev.
 *
 * The cache file at `<dataDir>/model-catalog.json` is a flat
 * `"<provider>/<model>"` → {@link ModelInfo} map so lookups are O(1). The
 * raw models.dev payload is provider-keyed; we flatten it on ingest.
 *
 * Reads are sync; refresh runs in the background once a day. Set
 * `GLORP_DISABLE_CATALOG_REFRESH=1` to freeze the cache (useful for
 * benchmark reproducibility and unit tests).
 */
export class ModelCatalog {
  private readonly cachePath: string;
  private cache: CacheFile | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(dataDir: string, opts: { fetchImpl?: typeof fetch } = {}) {
    this.cachePath = path.join(dataDir, "model-catalog.json");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cache = this.loadFromDisk();
  }

  /**
   * Look up the context limit for a (providerId, model) pair. Returns
   * `undefined` if the catalog has no match — callers fall back to a default.
   * Kicks a background refresh when the cache is past its TTL.
   */
  getContextLimit(providerId: string, model: string): number | undefined {
    const info = this.getModelInfo(providerId, model);
    return info?.context && info.context > 0 ? info.context : undefined;
  }

  /**
   * Look up the full catalog record. Tries exact "<providerId>/<model>",
   * then provider-agnostic by model id, then a dated-suffix match for the
   * "claude-opus-4-7" → "claude-opus-4-7-20251201" case.
   */
  getModelInfo(providerId: string, model: string): ModelInfo | undefined {
    this.maybeRefresh();
    const entries = this.cache?.entries ?? {};
    for (const key of candidateKeys(providerId, model)) {
      const hit = entries[key];
      if (hit) return hit;
    }
    return suffixMatch(entries, providerId, model);
  }

  /** Force a refresh now and await it. Network failures are swallowed. */
  async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const resp = await this.fetchImpl(MODELS_DEV_URL, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) return;
        const json = (await resp.json()) as RawModelsDevPayload;
        const flat = flattenModelsDevPayload(json);
        const next: CacheFile = { fetched_at: Date.now(), source: MODELS_DEV_URL, entries: flat };
        this.cache = next;
        this.writeToDisk(next);
      } catch {
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  /** Most recent fetch timestamp (epoch ms), or null if no cache. */
  get fetchedAt(): number | null {
    return this.cache?.fetched_at ?? null;
  }

  private maybeRefresh(): void {
    if (process.env.GLORP_DISABLE_CATALOG_REFRESH === "1") return;
    const age = this.cache ? Date.now() - this.cache.fetched_at : Infinity;
    if (age < CACHE_TTL_MS) return;
    void this.refresh();
  }

  private loadFromDisk(): CacheFile | null {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, "utf-8")) as CacheFile;
      if (typeof parsed?.fetched_at !== "number" || typeof parsed?.entries !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private writeToDisk(file: CacheFile): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(file), { encoding: "utf-8" });
      fs.renameSync(tmp, this.cachePath);
    } catch {}
  }
}

/**
 * Flatten the models.dev payload into the `"<providerId>/<modelId>"` map
 * the catalog uses internally. We also stash a provider-agnostic bare-id
 * key for the common "user typed `gpt-5` against a custom provider"
 * lookup; the first-wins ordering of the source data wins ties.
 */
function flattenModelsDevPayload(raw: RawModelsDevPayload): Record<string, ModelInfo> {
  const out: Record<string, ModelInfo> = {};
  for (const [providerId, providerEntry] of Object.entries(raw)) {
    const models = providerEntry?.models ?? {};
    for (const [modelId, rawModel] of Object.entries(models)) {
      const info = toModelInfo(providerId, modelId, rawModel);
      out[`${providerId}/${modelId}`] = info;
      if (!out[modelId]) out[modelId] = info;
    }
  }
  return out;
}

function toModelInfo(providerId: string, modelId: string, raw: RawModelEntry): ModelInfo {
  return {
    providerId,
    id: raw.id ?? modelId,
    name: raw.name,
    family: raw.family,
    context: raw.limit?.context,
    output: raw.limit?.output,
    cost: raw.cost ? sanitizeCost(raw.cost) : undefined,
    modalities: raw.modalities,
    tool_call: raw.tool_call,
    attachment: raw.attachment,
    reasoning: raw.reasoning,
    knowledge: raw.knowledge,
    release_date: raw.release_date,
  };
}

function sanitizeCost(c: ModelCost): ModelCost {
  const out: ModelCost = {};
  if (c.input != null) out.input = c.input;
  if (c.output != null) out.output = c.output;
  if (c.cache_read != null) out.cache_read = c.cache_read;
  if (c.cache_write != null) out.cache_write = c.cache_write;
  return out;
}

function candidateKeys(providerId: string, model: string): string[] {
  const keys: string[] = [];
  const push = (k: string) => { if (!keys.includes(k)) keys.push(k); };
  push(`${providerId}/${model}`);
  push(model);
  // OpenRouter-style routed names: "anthropic/claude-opus-4-7" against
  // provider "openrouter" should also match the same key under anthropic.
  if (model.includes("/")) {
    const tail = model.slice(model.lastIndexOf("/") + 1);
    const head = model.slice(0, model.lastIndexOf("/"));
    push(model);
    push(`${head}/${tail}`);
    push(tail);
  }
  return keys;
}

/**
 * Match unversioned names (e.g. "claude-opus-4-7") against dated/numbered
 * variants ("claude-opus-4-7-20251201"). Only accepts suffixes that look
 * like dates, numeric versions, or "latest" so we don't accidentally match
 * unrelated model families.
 */
function suffixMatch(
  entries: Record<string, ModelInfo>,
  providerId: string,
  model: string,
): ModelInfo | undefined {
  const prefix = `${model}-`;
  const providerScope = `${providerId}/`;
  const candidates: ModelInfo[] = [];
  for (const [key, info] of Object.entries(entries)) {
    const lastSeg = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    if (!lastSeg.startsWith(prefix)) continue;
    const tail = lastSeg.slice(prefix.length);
    if (!/^(\d{8}|\d+|latest|v\d.*)$/.test(tail)) continue;
    // Prefer matches under the right provider.
    if (key.startsWith(providerScope)) return info;
    candidates.push(info);
  }
  // Otherwise return whichever has the largest context window — usually
  // the latest dated variant.
  candidates.sort((a, b) => (b.context ?? 0) - (a.context ?? 0));
  return candidates[0];
}
