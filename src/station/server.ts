/**
 * Glorp Station — a long-running multi-session runtime. One Bun.serve()
 * instance exposes a REST API for managing sessions and a WebSocket endpoint
 * (`/sessions/:id/events`) for streaming each session's events.
 *
 * Composed from the agent layer (`buildGlorp`) via the SessionManager — this
 * is intentionally separate from the single-session `src/server/`.
 */

import * as path from "node:path";
import type { SessionManager } from "./manager.ts";
import { createStationRouter } from "./router.ts";
import { makeWsData, handleWsOpen, handleWsClose, handleWsMessage, type WsData } from "./ws.ts";
import { CredentialsStore } from "../agent/credentials.ts";
import { TemplateStore } from "./templates/store.ts";
import { NamespaceStore, DEFAULT_NAMESPACE_ID } from "./namespace-store.ts";
import { NamespaceRegistry, NamespaceNotFoundError, type NamespaceBundle } from "./namespace-registry.ts";
import { namespaceControlRoutes } from "./routes/namespaces.ts";
import { healthRoute } from "./routes/health.ts";
import { KeyStore } from "./auth/key-store.ts";
import { requireAuth, requireScope, NamespaceForbiddenError } from "./auth/middleware.ts";
import type { ApiKey } from "./auth/types.ts";
import { authRequired, type StationConfig } from "./config.ts";
import { json } from "./respond.ts";
import { withCors, rejectBrowserOrigin, preflight } from "./cors.ts";
export { isAllowedBrowserOrigin } from "./cors.ts";

/** Admin-only route prefixes — gated to the `admin` scope, namespace-agnostic. */
function isAdminRoute(routePath: string): boolean {
  return (
    routePath === "/keys" ||
    routePath.startsWith("/keys/") ||
    routePath === "/namespaces" ||
    routePath.startsWith("/namespaces/")
  );
}

/** Map a namespace-resolution failure to the right HTTP status. */
function namespaceError(err: unknown): Response {
  if (err instanceof NamespaceForbiddenError) return json({ error: "forbidden", message: err.message }, 403);
  if (err instanceof NamespaceNotFoundError) return json({ error: "not_found", message: err.message }, 404);
  return json({ error: "internal", message: err instanceof Error ? err.message : String(err) }, 500);
}

const WS_PATH = /^\/sessions\/([^/]+)\/events$/;

/** The stable, versioned API prefix. Requests may arrive with or without it. */
const API_V1 = "/api/v1";

/** Strip a leading `/api/v1` so the existing route regexes match unchanged. */
function stripApiPrefix(pathname: string): string {
  if (pathname === API_V1) return "/";
  if (pathname.startsWith(API_V1 + "/")) return pathname.slice(API_V1.length);
  return pathname;
}

export interface StationHandle {
  port: number;
  manager: SessionManager;
  stop: () => Promise<void>;
}

export async function startStation(config: StationConfig): Promise<StationHandle> {
  const stationCredentials = new CredentialsStore(config.dataDir);
  const templates = new TemplateStore(config.templatesDir);
  const namespaceStore = new NamespaceStore(config.dataDir, config.workspaceRoot);
  const registry = new NamespaceRegistry(namespaceStore, config, templates, stationCredentials);
  const startedAt = Date.now();
  const keyStore = new KeyStore(config.auth?.keyStorage ?? path.join(config.dataDir, "glorp-keys.json"));
  const authOn = authRequired(config);
  const namespaceCtl = namespaceControlRoutes(namespaceStore, registry, keyStore, config);
  const router = createStationRouter(templates, keyStore, namespaceCtl);

  const server = Bun.serve<WsData>({
    hostname: config.hostname,
    port: config.port,

    async fetch(req, srv) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return preflight(req, url);

      const blocked = rejectBrowserOrigin(req, url);
      if (blocked) return withCors(req, url, blocked);

      // The public API is also mounted under /api/v1; strip it so every route
      // regex below matches the same way for both prefixes.
      const routePath = stripApiPrefix(url.pathname);

      const wsMatch = routePath.match(WS_PATH);
      if (wsMatch && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        let key: ApiKey | null = null;
        if (authOn) {
          const auth = await requireAuth(req, url, keyStore);
          if (!auth.ok) return withCors(req, url, auth.response);
          key = auth.key;
        }
        let bundle: NamespaceBundle;
        try {
          // Browsers can't set headers on a WebSocket, so accept `?ns=` too.
          const requested = req.headers.get("x-glorp-namespace") ?? url.searchParams.get("ns");
          bundle = registry.bundleForKey(key, requested);
        } catch (err) {
          return withCors(req, url, namespaceError(err));
        }
        const session = bundle.manager.getOrRehydrate(wsMatch[1]!);
        if (!session) {
          return withCors(req, url, json({ error: "not_found", message: "Session not found" }, 404));
        }
        if (srv.upgrade(req, { data: makeWsData(session) })) return undefined;
        return withCors(req, url, new Response("WebSocket upgrade failed", { status: 500 }));
      }

      if (url.pathname === "/" && req.method === "GET") {
        return withCors(req, url, json({ status: "ok", service: "glorp-station" }));
      }

      // Health is open (no auth, no namespace) and reports across all namespaces.
      if (routePath === "/health" && req.method === "GET") {
        return withCors(req, url, healthRoute(registry, startedAt));
      }

      // API-key auth + admin gate for the relevant routes.
      let key: ApiKey | null = null;
      if (authOn) {
        const auth = await requireAuth(req, url, keyStore);
        if (!auth.ok) return withCors(req, url, auth.response);
        key = auth.key;
        if (isAdminRoute(routePath)) {
          const denied = requireScope(auth.key, "admin");
          if (denied) return withCors(req, url, denied);
        }
      }

      // Resolve the namespace bundle. Admin routes operate cross-namespace via
      // the control plane, so they don't honor X-Glorp-Namespace (and never 404
      // on a not-yet-created namespace) — they always get the default bundle.
      let bundle: NamespaceBundle;
      try {
        bundle = isAdminRoute(routePath)
          ? registry.resolve(DEFAULT_NAMESPACE_ID)
          : registry.bundleForKey(key, req.headers.get("x-glorp-namespace"));
      } catch (err) {
        return withCors(req, url, namespaceError(err));
      }

      try {
        return withCors(req, url, await router.route(req, routePath, bundle));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return withCors(req, url, json({ error: "internal", message }, 500));
      }
    },

    websocket: {
      open(ws) {
        handleWsOpen(ws);
      },
      message(ws, data) {
        handleWsMessage(ws, data);
      },
      close(ws) {
        handleWsClose(ws);
      },
    },
  });

  const port = server.port ?? config.port;
  // Reflect the actually-bound port back so ws_urls are correct (matters when
  // the caller passed port 0 to get an ephemeral port, e.g. in tests).
  config.port = port;
  console.log(`[glorp-station] listening on ${config.hostname}:${port} (dataDir: ${config.dataDir})`);
  if (authOn) {
    const count = (await keyStore.list().catch(() => [])).length;
    console.log(`[glorp-station] API-key auth: REQUIRED (${count} key${count === 1 ? "" : "s"})`);
    if (count === 0) {
      console.warn("[glorp-station]   No API keys yet — run `glorp station keys add <name>` to create one.");
    }
  } else {
    console.log("[glorp-station] API-key auth: off (loopback). Bind a non-loopback host or set auth to enable.");
  }

  return {
    port,
    // Back-compat handle: the default namespace's manager.
    manager: registry.resolve(DEFAULT_NAMESPACE_ID).manager,
    async stop() {
      for (const bundle of registry.liveBundles()) await bundle.manager.shutdownAll();
      await keyStore.close().catch(() => {});
      server.stop();
      console.log("[glorp-station] stopped");
    },
  };
}
