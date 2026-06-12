/**
 * Typed client for the Garage REST API. All requests are made from the browser
 * with the admin JWT (or an API key) as a Bearer token and an optional
 * X-Glorp-Namespace header. The base URL resolves PER REQUEST, so nothing is
 * hardcoded anywhere: a user override saved from the sign-in screen
 * (localStorage) wins, then the operator's runtime-config.js
 * (window.__GARAGE_URL__, written by the container entrypoint from the
 * GARAGE_URL env), then the build-baked NEXT_PUBLIC_GARAGE_URL, and finally
 * the dashboard's own hostname on Garage's port — which is exactly where the
 * all-in-one container serves Garage, from any machine, with zero config.
 */

declare global {
  interface Window {
    __GARAGE_URL__?: string;
  }
}

const TOKEN_KEY = "garage.token";
const NS_KEY = "garage.namespace";
const URL_KEY = "garage.url";

/** Operator-provided URL: runtime-config.js (container env) → build-baked env. */
export function deploymentGarageUrl(): string | null {
  const runtime = typeof window === "undefined" ? undefined : window.__GARAGE_URL__;
  return runtime || process.env.NEXT_PUBLIC_GARAGE_URL || null;
}

/** Per-browser override saved from the sign-in screen. */
export function getStoredGarageUrl(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(URL_KEY);
}
export function setStoredGarageUrl(url: string | null): void {
  if (typeof window === "undefined") return;
  if (url) localStorage.setItem(URL_KEY, url);
  else localStorage.removeItem(URL_KEY);
}

/** Effective Garage URL — resolved at call time so a sign-in-screen change applies without a reload. */
export function garageUrl(): string {
  const chosen = getStoredGarageUrl() || deploymentGarageUrl();
  if (chosen) return chosen.replace(/\/+$/, "");
  if (typeof window !== "undefined") return `${location.protocol}//${location.hostname}:4271`;
  return "http://127.0.0.1:4271";
}

export function apiBase(): string {
  return `${garageUrl()}/api/v1`;
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getNamespace(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(NS_KEY);
}
export function setNamespace(ns: string | null): void {
  if (typeof window === "undefined") return;
  if (ns) localStorage.setItem(NS_KEY, ns);
  else localStorage.removeItem(NS_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Opts {
  method?: string;
  body?: unknown;
  namespace?: string | null;
  auth?: boolean;
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (opts.auth !== false && token) headers.authorization = `Bearer ${token}`;
  const ns = opts.namespace ?? getNamespace();
  if (ns) headers["x-glorp-namespace"] = ns;

  const res = await fetch(apiBase() + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** WebSocket URL for a session's event stream (token + ns ride as query params). */
export function sessionWsUrl(id: string): string {
  const u = new URL(`${apiBase()}/sessions/${id}/events`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken();
  if (token) u.searchParams.set("api_key", token);
  const ns = getNamespace();
  if (ns) u.searchParams.set("ns", ns);
  return u.toString();
}
