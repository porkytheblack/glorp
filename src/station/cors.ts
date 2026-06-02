/** CORS headers + browser-origin policy for Station's HTTP/WS surface. */

import { json } from "./respond.ts";

const CORS_BASE: Record<string, string> = {
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-glorp-namespace",
};

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
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === requestUrl.origin) return true;
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
