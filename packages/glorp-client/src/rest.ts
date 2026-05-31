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

/** Upload `multipart/form-data`; lets fetch set the boundary content-type. */
export async function requestForm<T>(cfg: GlorpConfig, path: string, form: FormData): Promise<T> {
  const doFetch = cfg.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["authorization"] = `Bearer ${cfg.apiKey}`;

  const res = await doFetch(`${apiBase(cfg)}${path}`, {
    method: "POST",
    headers,
    body: form,
    signal: cfg.timeoutMs ? AbortSignal.timeout(cfg.timeoutMs) : undefined,
  });
  const text = await res.text();
  const json: unknown = text ? safeParse(text) : undefined;
  if (!res.ok) {
    const e = (json ?? {}) as { error?: string; message?: string };
    throw new GlorpRemoteError(res.status, e.error ?? "error", e.message ?? text);
  }
  return json as T;
}

/** Download raw bytes (e.g. a generated file) as a `Uint8Array`. */
export async function requestBinary(cfg: GlorpConfig, method: string, path: string): Promise<Uint8Array> {
  const doFetch = cfg.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["authorization"] = `Bearer ${cfg.apiKey}`;

  const res = await doFetch(`${apiBase(cfg)}${path}`, {
    method,
    headers,
    signal: cfg.timeoutMs ? AbortSignal.timeout(cfg.timeoutMs) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const e = (text ? safeParse(text) : {}) as { error?: string; message?: string };
    throw new GlorpRemoteError(res.status, e.error ?? "error", e.message ?? text);
  }
  return new Uint8Array(await res.arrayBuffer());
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
