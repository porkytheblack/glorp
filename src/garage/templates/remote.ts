/**
 * Client for the companion service's template registry
 * (docs/companion-service-spec.md §3). One GET returns full Template v2
 * documents; the service resolves its own skill library into the inline
 * `files` form, so this client never fetches assets. Failure posture: the
 * registry is OPTIONAL at runtime — on any error we serve the last known
 * good copy (empty until the first successful fetch) and log once per
 * distinct error, so a down service degrades to "registry templates
 * temporarily frozen", never to a broken Garage.
 */

import type { Template } from "./types.ts";
import { normalizeTemplate } from "./normalize.ts";

export interface RemoteRegistryConfig {
  /** Base list URL, e.g. `https://svc/v1/templates`. */
  url: string;
  headers?: Record<string, string>;
}

/** Revalidate the list at most this often (spec §3.2). */
const DEFAULT_TTL_MS = 60_000;

export class RemoteTemplateRegistry {
  private templates = new Map<string, Template>();
  private etag: string | null = null;
  private fetchedAt = 0;
  private lastError: string | null = null;

  constructor(
    private readonly config: RemoteRegistryConfig,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  /** Last known good registry contents, revalidated when stale. */
  async list(): Promise<Template[]> {
    await this.revalidate();
    return [...this.templates.values()];
  }

  async get(name: string): Promise<Template | undefined> {
    await this.revalidate();
    const hit = this.templates.get(name);
    if (hit) return hit;
    // Cache miss after a fresh list usually means "unknown", but try the
    // single-document endpoint so a registry serving a partial list (or one
    // updated between our revalidations) still resolves.
    return this.fetchOne(name);
  }

  private async revalidate(): Promise<void> {
    if (Date.now() - this.fetchedAt < this.ttlMs) return;
    try {
      const res = await fetch(this.config.url, {
        headers: { ...this.config.headers, ...(this.etag ? { "if-none-match": this.etag } : {}) },
      });
      if (res.status === 304) {
        this.fetchedAt = Date.now();
        return;
      }
      if (!res.ok) {
        this.noteError(`registry responded ${res.status}`);
        return;
      }
      const body = (await res.json()) as { templates?: Array<Partial<Template>> };
      const next = new Map<string, Template>();
      for (const raw of body.templates ?? []) {
        // Registry documents must carry their own name (spec §3.3).
        const t = normalizeTemplate(raw);
        if (t) next.set(t.name, t);
      }
      this.templates = next;
      this.etag = res.headers.get("etag");
      this.fetchedAt = Date.now();
      this.lastError = null;
    } catch (err) {
      this.noteError(err instanceof Error ? err.message : String(err));
    }
  }

  private async fetchOne(name: string): Promise<Template | undefined> {
    try {
      const res = await fetch(`${this.config.url.replace(/\/$/, "")}/${encodeURIComponent(name)}`, {
        headers: this.config.headers,
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { template?: Partial<Template> };
      const t = body.template ? normalizeTemplate(body.template) : undefined;
      if (t) this.templates.set(t.name, t);
      return t;
    } catch (err) {
      this.noteError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /** Serve stale silently, but log each distinct failure once. */
  private noteError(message: string): void {
    // Even a failed revalidation refreshes the clock — a down registry must
    // not turn every template read into a synchronous network timeout.
    this.fetchedAt = Date.now();
    if (this.lastError !== message) {
      this.lastError = message;
      console.warn(`[glorp-garage] template registry: ${message} (serving last known good)`);
    }
  }
}
