/**
 * REST helpers for the Glorp client.
 * Thin typed wrappers around fetch() for every server endpoint.
 */

import type { ErrorResponse } from "../protocol/envelope.ts";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  HealthResponse,
  ListSessionsResponse,
  GetSessionResponse,
  ListProfilesResponse,
} from "../protocol/rest.ts";

/** Build standard headers, optionally including a bearer token. */
export function buildHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function handleError(res: Response, method: string, path: string): Promise<never> {
  const body = await res.json().catch(() => null) as ErrorResponse | null;
  throw new Error(body?.message ?? `${method} ${path} failed: ${res.status} ${res.statusText}`);
}

async function get<T>(baseUrl: string, path: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  if (!res.ok) await handleError(res, "GET", path);
  return res.json() as Promise<T>;
}

async function post<T>(baseUrl: string, path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleError(res, "POST", path);
  return res.json() as Promise<T>;
}

async function del(baseUrl: string, path: string, headers: Record<string, string>): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers });
  if (!res.ok) await handleError(res, "DELETE", path);
}

// ── Typed endpoint functions ────────────────────────────────

export function health(baseUrl: string, headers: Record<string, string>): Promise<HealthResponse> {
  return get<HealthResponse>(baseUrl, "/api/v1/health", headers);
}

export function createSession(
  baseUrl: string, headers: Record<string, string>, opts?: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  return post<CreateSessionResponse>(baseUrl, "/api/v1/sessions", opts ?? {}, headers);
}

export function listSessions(
  baseUrl: string, headers: Record<string, string>, scope?: string, limit?: number,
): Promise<ListSessionsResponse> {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  return get<ListSessionsResponse>(baseUrl, `/api/v1/sessions${qs ? `?${qs}` : ""}`, headers);
}

export function getSession(
  baseUrl: string, headers: Record<string, string>, id: string,
): Promise<GetSessionResponse> {
  return get<GetSessionResponse>(baseUrl, `/api/v1/sessions/${encodeURIComponent(id)}`, headers);
}

export function deleteSession(
  baseUrl: string, headers: Record<string, string>, id: string,
): Promise<void> {
  return del(baseUrl, `/api/v1/sessions/${encodeURIComponent(id)}`, headers);
}

export function listProfiles(
  baseUrl: string, headers: Record<string, string>,
): Promise<ListProfilesResponse> {
  return get<ListProfilesResponse>(baseUrl, "/api/v1/profiles", headers);
}
