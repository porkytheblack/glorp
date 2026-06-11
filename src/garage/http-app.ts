/**
 * The Garage HTTP/WS surface, expressed as a Hono app. CORS + browser-origin
 * policy run as middleware; a single catch-all delegates REST to the existing
 * `GarageRouter` (auth, admin gating, namespace resolution preserved exactly);
 * WebSocket upgrades use Hono's Bun adapter. `server.ts` owns the lifecycle.
 */

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import type { GarageSession } from "./session.ts";
import type { GarageRouter } from "./router.ts";
import type { KeyStore } from "./auth/key-store.ts";
import { makeWsData, handleWsOpen, handleWsClose, handleWsMessage, type WsData } from "./ws.ts";
import { NamespaceRegistry, NamespaceNotFoundError, type NamespaceBundle } from "./namespace-registry.ts";
import { DEFAULT_NAMESPACE_ID } from "./namespace-store.ts";
import { healthRoute } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { requireAuth, requireScope, NamespaceForbiddenError } from "./auth/middleware.ts";
import type { ApiKey } from "./auth/types.ts";
import { json } from "./respond.ts";
import { withCors, rejectBrowserOrigin, preflight } from "./cors.ts";

/** The stable, versioned API prefix. Requests may arrive with or without it. */
const API_V1 = "/api/v1";

/** Admin-only route prefixes — gated to the `admin` scope, namespace-agnostic. */
function isAdminRoute(routePath: string): boolean {
  return (
    routePath === "/keys" ||
    routePath.startsWith("/keys/") ||
    routePath === "/namespaces" ||
    routePath.startsWith("/namespaces/") ||
    routePath === "/storage"
  );
}

/** Strip a leading `/api/v1` so the existing route regexes match unchanged. */
function stripApiPrefix(pathname: string): string {
  if (pathname === API_V1) return "/";
  if (pathname.startsWith(API_V1 + "/")) return pathname.slice(API_V1.length);
  return pathname;
}

/** Map a namespace-resolution failure to the right HTTP status. */
function namespaceError(err: unknown): Response {
  if (err instanceof NamespaceForbiddenError) return json({ error: "forbidden", message: err.message }, 403);
  if (err instanceof NamespaceNotFoundError) return json({ error: "not_found", message: err.message }, 404);
  return json({ error: "internal", message: err instanceof Error ? err.message : String(err) }, 500);
}

/** A WSContext adapter so the transport-agnostic ws.ts handlers can drive it. */
type WsLike = { data: WsData; send: (d: string) => void; readyState: number };

export interface GarageAppDeps {
  registry: NamespaceRegistry;
  router: GarageRouter;
  keyStore: KeyStore;
  authOn: boolean;
  startedAt: number;
}

/** Per-request context vars carried between the WS auth gate and the upgrade. */
type GarageEnv = { Variables: { wsSession: GarageSession } };

/** Build the Hono app plus the Bun `websocket` handler `server.ts` mounts. */
export function buildGarageApp(deps: GarageAppDeps) {
  const { registry, router, keyStore, authOn, startedAt } = deps;
  const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();
  const auth = authRoutes();
  const app = new Hono<GarageEnv>();

  // --- CORS + browser-origin policy ---
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (c.req.method === "OPTIONS") return preflight(c.req.raw, url);
    const blocked = rejectBrowserOrigin(c.req.raw, url);
    if (blocked) return withCors(c.req.raw, url, blocked);
    await next();
    // Leave the 101 upgrade response untouched; wrap everything else.
    if (c.res && c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      c.res = withCors(c.req.raw, url, c.res);
    }
  });

  // --- WebSocket: GET /sessions/:id/events (with or without /api/v1) ---
  const wsResolve = async (c: { req: { raw: Request; url: string; param: (k: string) => string; header: (k: string) => string | undefined } }, set: (s: GarageSession) => void): Promise<Response | null> => {
    const url = new URL(c.req.url);
    let key: ApiKey | null = null;
    if (authOn) {
      const auth = await requireAuth(c.req.raw, url, keyStore);
      if (!auth.ok) return auth.response;
      key = auth.key;
    }
    let bundle: NamespaceBundle;
    try {
      const requested = c.req.header("x-glorp-namespace") ?? url.searchParams.get("ns");
      bundle = registry.bundleForKey(key, requested);
    } catch (err) {
      return namespaceError(err);
    }
    const session = bundle.manager.getOrRehydrate(c.req.param("id"));
    if (!session) return json({ error: "not_found", message: "Session not found" }, 404);
    set(session);
    return null;
  };

  for (const base of ["", API_V1]) {
    app.get(
      `${base}/sessions/:id/events`,
      async (c, next) => {
        const fail = await wsResolve(c, (s) => c.set("wsSession", s));
        if (fail) return fail;
        return next();
      },
      upgradeWebSocket((c) => {
        const data = makeWsData(c.get("wsSession") as GarageSession);
        // Read the LIVE socket state via `ws.raw`: hono's WSContext.readyState is
        // a per-event snapshot, so the broadcasters' "skip dead client" guard
        // needs the underlying ServerWebSocket to stay accurate.
        type RawWs = { send: (d: string) => void; readyState: number; raw?: { readyState: number } };
        const wrap = (ws: RawWs): WsLike => ({
          data,
          send: (d) => ws.send(d),
          get readyState() {
            return ws.raw?.readyState ?? ws.readyState;
          },
        });
        return {
          onOpen: (_e, ws) => handleWsOpen(wrap(ws) as never),
          onMessage: (e, ws) => handleWsMessage(wrap(ws) as never, String(e.data)),
          onClose: (_e, ws) => handleWsClose(wrap(ws) as never),
        };
      }),
    );
  }

  // --- Everything else: REST, delegated to the existing router. ---
  app.all("*", async (c) => {
    const url = new URL(c.req.url);
    const routePath = stripApiPrefix(url.pathname);

    if (url.pathname === "/" && c.req.method === "GET") {
      return json({ status: "ok", service: "glorp-garage" });
    }
    if (routePath === "/health" && c.req.method === "GET") {
      return healthRoute(registry, startedAt);
    }
    // Admin login is open — it issues the credential the dashboard then uses.
    if (routePath === "/auth/status" && c.req.method === "GET") return auth.status();
    if (routePath === "/auth/login" && c.req.method === "POST") return auth.login(c.req.raw);

    let key: ApiKey | null = null;
    if (authOn) {
      const authResult = await requireAuth(c.req.raw, url, keyStore);
      if (!authResult.ok) return authResult.response;
      key = authResult.key;
      if (isAdminRoute(routePath)) {
        const denied = requireScope(authResult.key, "admin");
        if (denied) return denied;
      }
    }

    // Identity echo — best-effort even when auth is off (loopback), so the
    // dashboard can recognize a presented JWT.
    if (routePath === "/auth/me" && c.req.method === "GET") {
      if (!key) {
        const probe = await requireAuth(c.req.raw, url, keyStore);
        if (probe.ok) key = probe.key;
      }
      return auth.me(key);
    }

    let bundle: NamespaceBundle;
    try {
      // Namespace comes from the header, or — like the WS path — the `ns`
      // query param: plain <a href> downloads are top-level navigations that
      // cannot set headers. bundleForKey enforces key↔namespace authorization
      // either way when auth is on.
      bundle = isAdminRoute(routePath)
        ? registry.resolve(DEFAULT_NAMESPACE_ID)
        : registry.bundleForKey(key, c.req.header("x-glorp-namespace") ?? url.searchParams.get("ns") ?? null);
    } catch (err) {
      return namespaceError(err);
    }

    try {
      return await router.route(c.req.raw, routePath, bundle);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: "internal", message }, 500);
    }
  });

  return { app, websocket };
}
