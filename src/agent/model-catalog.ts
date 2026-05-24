import * as fs from "node:fs";
import * as path from "node:path";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export const DEFAULT_FALLBACK_CONTEXT_LIMIT = 128_000;

interface LiteLLMEntry {
  max_input_tokens?: number;
  max_tokens?: number;
  litellm_provider?: string;
  mode?: string;
}

interface CacheFile {
  fetched_at: number;
  source: string;
  entries: Record<string, LiteLLMEntry>;
}

/**
 * Disk-cached lookup of model context windows, sourced from LiteLLM's
 * `model_prices_and_context_window.json` on GitHub. Reads are sync; refresh
 * runs in the background once a day. Set `GLORP_DISABLE_CATALOG_REFRESH=1`
 * to freeze the cache (useful for benchmark reproducibility).
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
    this.maybeRefresh();
    const entries = this.cache?.entries ?? {};
    for (const key of candidateKeys(providerId, model)) {
      const limit = readLimit(entries[key]);
      if (limit) return limit;
    }
    return suffixMatch(entries, model);
  }

  /** Force a refresh now and await it. Network failures are swallowed. */
  async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const resp = await this.fetchImpl(LITELLM_URL, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) return;
        const json = (await resp.json()) as Record<string, LiteLLMEntry>;
        delete (json as any).sample_spec;
        const next: CacheFile = { fetched_at: Date.now(), source: LITELLM_URL, entries: json };
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

function readLimit(entry: LiteLLMEntry | undefined): number | undefined {
  if (!entry) return undefined;
  const limit = entry.max_input_tokens ?? entry.max_tokens;
  return limit && limit > 0 ? limit : undefined;
}

function candidateKeys(providerId: string, model: string): string[] {
  const keys = new Set<string>();
  keys.add(model);
  keys.add(`${providerId}/${model}`);
  keys.add(`openrouter/${model}`);
  keys.add(`openrouter/${providerId}/${model}`);
  if (model.includes("/")) {
    keys.add(model.replace(/^openrouter\//, ""));
    keys.add(model.slice(model.lastIndexOf("/") + 1));
  }
  return [...keys];
}

/**
 * Match unversioned names (e.g. "claude-opus-4-7") against dated/numbered
 * variants ("claude-opus-4-7-20251201"). Only accepts suffixes that look
 * like dates, numeric versions, or "latest" so we don't accidentally match
 * unrelated model families.
 */
function suffixMatch(entries: Record<string, LiteLLMEntry>, model: string): number | undefined {
  const prefix = `${model}-`;
  const matches: number[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    const lastSeg = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    if (!lastSeg.startsWith(prefix)) continue;
    const tail = lastSeg.slice(prefix.length);
    if (!/^(\d{8}|\d+|latest|v\d.*)$/.test(tail)) continue;
    const limit = readLimit(entry);
    if (limit) matches.push(limit);
  }
  return matches.length ? Math.max(...matches) : undefined;
}
