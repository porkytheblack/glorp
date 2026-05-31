/**
 * Request authentication for Station. Accepts an API key as a Bearer token
 * (`Authorization: Bearer glsk_…`) or, for WebSocket upgrades that can't set
 * headers, an `?api_key=` query param. `requireScope` gates admin-only routes
 * (a key with the `admin` scope implies every scope).
 */

import { errorJson } from "../respond.ts";
import type { KeyStore } from "./key-store.ts";
import type { ApiKey } from "./types.ts";

/** Pull the raw key from the Authorization header or the `api_key` query param. */
export function extractKey(req: Request, url: URL): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const q = url.searchParams.get("api_key");
  return q ? q.trim() : null;
}

export type AuthResult = { ok: true; key: ApiKey } | { ok: false; response: Response };

/** Verify the request's API key, returning the record or a 401 response. */
export async function requireAuth(req: Request, url: URL, keyStore: KeyStore): Promise<AuthResult> {
  const raw = extractKey(req, url);
  if (!raw) return { ok: false, response: errorJson("unauthorized", "Missing API key", 401) };
  const key = await keyStore.verify(raw);
  if (!key) return { ok: false, response: errorJson("unauthorized", "Invalid or revoked API key", 401) };
  return { ok: true, key };
}

/** Returns a 403 response if the key lacks `scope` (admin implies all), else null. */
export function requireScope(key: ApiKey, scope: string): Response | null {
  if (key.scopes.includes("admin") || key.scopes.includes(scope)) return null;
  return errorJson("forbidden", `Missing required scope: ${scope}`, 403);
}
