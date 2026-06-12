/** CORS headers + browser-origin policy for Garage's HTTP/WS surface. */

import { json } from "./respond.ts";

const CORS_BASE: Record<string, string> = {
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-glorp-namespace",
};

/**
 * Operator-configured extra origins (split-host deploys: dashboard on one
 * host, Garage on another). Set once at startup from
 * `GLORP_GARAGE_ALLOWED_ORIGINS` / garage.json `allowedOrigins`. "*" allows
 * every origin — auth still applies, but prefer explicit origins.
 */
let EXTRA_ORIGINS = new Set<string>();
let ALLOW_ANY = false;

export function configureAllowedOrigins(origins: string[]): void {
  ALLOW_ANY = origins.includes("*");
  EXTRA_ORIGINS = new Set(
    origins
      .filter((o) => o !== "*")
      .map((o) => {
        try {
          return new URL(o).origin.toLowerCase();
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
}

export function withCors(req: Request, url: URL, resp: Response): Response {
  const origin = req.headers.get("origin");
  if (origin && isAllowedBrowserOrigin(origin, url)) {
    resp.headers.set("access-control-allow-origin", origin);
    resp.headers.set("vary", "origin");
  }
  for (const [k, v] of Object.entries(CORS_BASE)) resp.headers.set(k, v);
  return resp;
}

export function isAllowedBrowserOrigin(origin: string | null, requestUrl: URL): boolean {
  if (!origin) return true;
  if (ALLOW_ANY) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === requestUrl.origin) return true;
  if (EXTRA_ORIGINS.has(parsed.origin.toLowerCase())) return true;
  return isLoopback(parsed.hostname) && isLoopback(requestUrl.hostname);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function rejectBrowserOrigin(req: Request, url: URL): Response | null {
  return isAllowedBrowserOrigin(req.headers.get("origin"), url)
    ? null
    : json({ error: "forbidden_origin", message: "Origin not allowed" }, 403);
}

export function preflight(req: Request, url: URL): Response {
  const blocked = rejectBrowserOrigin(req, url);
  return blocked ? withCors(req, url, blocked) : withCors(req, url, new Response(null, { status: 204 }));
}
