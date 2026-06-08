/**
 * Request authentication for Garage. Accepts an API key as a Bearer token
 * (`Authorization: Bearer glsk_…`) or, for WebSocket upgrades that can't set
 * headers, an `?api_key=` query param. `requireScope` gates admin-only routes
 * (a key with the `admin` scope implies every scope).
 */

import { errorJson } from "../respond.ts";
import { DEFAULT_NAMESPACE_ID } from "../namespace-store.ts";
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

/** Thrown when a tenant key tries to act in a namespace it isn't bound to. */
export class NamespaceForbiddenError extends Error {
  constructor(requested: string) {
    super(`Not authorized for namespace: ${requested}`);
  }
}

/**
 * Resolve the namespace a request targets, enforcing tenancy:
 *  - no key (auth off) → the `default` namespace; a requested header is ignored
 *    (without authentication there is no tenant to isolate — namespaces require
 *    auth to be meaningful).
 *  - a tenant key (bound to a namespace) may act ONLY in its own namespace; a
 *    mismatching `X-Glorp-Namespace` is a 403.
 *  - an `admin`-scoped key may target ANY namespace via the header; with no
 *    header it falls back to its own binding (or `default` when unbound).
 */
export function selectNamespaceId(key: ApiKey | null, requested: string | null): string {
  if (!key) return DEFAULT_NAMESPACE_ID;
  const bound = key.namespace ?? null;
  const isAdmin = key.scopes.includes("admin");
  if (requested && requested !== bound) {
    if (!isAdmin) throw new NamespaceForbiddenError(requested);
    return requested;
  }
  return bound ?? DEFAULT_NAMESPACE_ID;
}
