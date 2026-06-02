/**
 * Client configuration. `configure({ endpoint, apiKey })` sets the default used
 * by the top-level `run` / `streamSession`; `createClient(opts)` can also take an
 * explicit config. Auto-configures from `GLORP_ENDPOINT` / `GLORP_API_KEY` env
 * vars on first use. Mirrors the Station ecosystem's `configure`.
 */

export interface GlorpConfig {
  /** Base URL of the Station server, e.g. "https://glorp.example.com". */
  endpoint: string;
  /** API key (Bearer). Required unless the server runs auth-off on loopback. */
  apiKey?: string;
  /**
   * Target a tenant namespace. Sent as the `X-Glorp-Namespace` header on REST
   * (and `&ns=` on the WebSocket). Admin keys use this to act inside a namespace;
   * a namespace-bound tenant key doesn't need it (its key already scopes it).
   */
  namespace?: string;
  /** Override the global `fetch` (e.g. for Node < 18 or testing). */
  fetch?: typeof fetch;
  /** WebSocket implementation (e.g. Node's `ws`) when not in a browser/Bun. */
  WebSocketImpl?: typeof WebSocket;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

let active: GlorpConfig | null = null;

/**
 * Trim a namespace and reject a blank/whitespace-only value (which would send an
 * unusable `X-Glorp-Namespace` header). `undefined` (absent) is allowed.
 */
export function normalizeNamespace(ns?: string): string | undefined {
  if (ns === undefined) return undefined;
  const trimmed = ns.trim();
  if (trimmed === "") throw new Error("glorp-client: `namespace` must not be blank.");
  return trimmed;
}

function normalize(c: GlorpConfig): GlorpConfig {
  return { ...c, endpoint: c.endpoint.replace(/\/+$/, ""), namespace: normalizeNamespace(c.namespace) };
}

/** Set the default client config (used by the top-level `run`/`streamSession`). */
export function configure(config: GlorpConfig): void {
  active = normalize(config);
}

function fromEnv(): GlorpConfig | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const endpoint = env?.GLORP_ENDPOINT;
  if (!endpoint) return null;
  return normalize({ endpoint, apiKey: env?.GLORP_API_KEY });
}

/** Resolve a config: explicit `opts` win, else the configured default, else env. */
export function resolveConfig(opts?: GlorpConfig): GlorpConfig {
  if (opts) return normalize(opts);
  if (!active) active = fromEnv();
  if (!active) {
    throw new Error(
      "glorp-client is not configured. Call configure({ endpoint, apiKey }) or set GLORP_ENDPOINT (+ GLORP_API_KEY).",
    );
  }
  return active;
}

/** The stable, versioned REST base for an endpoint. */
export function apiBase(cfg: GlorpConfig): string {
  return `${cfg.endpoint}/api/v1`;
}
