/** Low-level typed REST helper: Bearer auth, timeout, `{data}` unwrap, errors. */

import { GlorpRemoteError } from "./errors.js";
import { apiBase, type GlorpConfig } from "./config.js";

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request<T>(cfg: GlorpConfig, method: string, path: string, body?: unknown): Promise<T> {
  const doFetch = cfg.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cfg.apiKey) headers["authorization"] = `Bearer ${cfg.apiKey}`;

  const res = await doFetch(`${apiBase(cfg)}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: cfg.timeoutMs ? AbortSignal.timeout(cfg.timeoutMs) : undefined,
  });

  const text = await res.text();
  const json: unknown = text ? safeParse(text) : undefined;

  if (!res.ok) {
    const e = (json ?? {}) as { error?: string; message?: string };
    throw new GlorpRemoteError(res.status, e.error ?? "error", e.message ?? text);
  }
  // Unwrap the `{ data }` envelope (keys routes) but pass bare bodies through.
  if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
    return (json as { data: T }).data;
  }
  return json as T;
}

/** Liveness check against `/api/v1/health` (never throws). */
export async function ping(cfg: GlorpConfig): Promise<boolean> {
  try {
    const doFetch = cfg.fetch ?? globalThis.fetch;
    const res = await doFetch(`${apiBase(cfg)}/health`, { signal: AbortSignal.timeout(cfg.timeoutMs ?? 5000) });
    return res.ok;
  } catch {
    return false;
  }
}
