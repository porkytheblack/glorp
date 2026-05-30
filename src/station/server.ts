/**
 * Glorp Station — a long-running multi-session runtime. One Bun.serve()
 * instance exposes a REST API for managing sessions and a WebSocket endpoint
 * (`/sessions/:id/events`) for streaming each session's events.
 *
 * Composed from the agent layer (`buildGlorp`) via the SessionManager — this
 * is intentionally separate from the single-session `src/server/`.
 */

import { SessionManager } from "./manager.ts";
import { createStationRouter } from "./router.ts";
import { makeWsData, handleWsOpen, handleWsClose, handleWsMessage, type WsData } from "./ws.ts";
import { CredentialsStore } from "../agent/credentials.ts";
import { TemplateStore } from "./templates/store.ts";
import { provision } from "./templates/engine.ts";
import { serveDashboard, dashboardBuilt, dashboardSearchPaths } from "./dashboard.ts";
import type { StationConfig } from "./config.ts";
import { json } from "./respond.ts";

/** GET paths owned by the REST API (everything else can be the dashboard SPA). */
const API_PREFIX = /^\/(sessions|health|models|templates)(\/|$)/;

const WS_PATH = /^\/sessions\/([^/]+)\/events$/;

const CORS_BASE: Record<string, string> = {
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function withCors(req: Request, url: URL, resp: Response): Response {
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

function rejectBrowserOrigin(req: Request, url: URL): Response | null {
  return isAllowedBrowserOrigin(req.headers.get("origin"), url)
    ? null
    : json({ error: "forbidden_origin", message: "Origin not allowed" }, 403);
}

function preflight(req: Request, url: URL): Response {
  const blocked = rejectBrowserOrigin(req, url);
  return blocked ? withCors(req, url, blocked) : withCors(req, url, new Response(null, { status: 204 }));
}

export interface StationHandle {
  port: number;
  manager: SessionManager;
  stop: () => Promise<void>;
}

export async function startStation(config: StationConfig): Promise<StationHandle> {
  const credentials = new CredentialsStore(config.dataDir);
  const templates = new TemplateStore(config.templatesDir);
  const manager = new SessionManager({
    dataDir: config.dataDir,
    workspaceRoot: config.workspaceRoot,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    permissionMode: config.permissionMode,
    templates: {
      has: (name) => templates.has(name),
      provision: (name, params, workspace) => provision(templates.get(name)!, params, workspace),
    },
  });
  const startedAt = Date.now();
  const router = createStationRouter(manager, config, credentials, templates, startedAt);

  const server = Bun.serve<WsData>({
    hostname: config.hostname,
    port: config.port,

    async fetch(req, srv) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return preflight(req, url);

      const blocked = rejectBrowserOrigin(req, url);
      if (blocked) return withCors(req, url, blocked);

      const wsMatch = url.pathname.match(WS_PATH);
      if (wsMatch && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const session = manager.getOrRehydrate(wsMatch[1]!);
        if (!session) {
          return withCors(req, url, json({ error: "not_found", message: "Session not found" }, 404));
        }
        if (srv.upgrade(req, { data: makeWsData(session) })) return undefined;
        return withCors(req, url, new Response("WebSocket upgrade failed", { status: 500 }));
      }

      // Dashboard SPA: serve any non-API GET (/, /assets/*, client routes).
      if (config.dashboard && req.method === "GET" && !API_PREFIX.test(url.pathname)) {
        return withCors(req, url, await serveDashboard(config.dataDir, url.pathname));
      }
      if (!config.dashboard && url.pathname === "/" && req.method === "GET") {
        return withCors(req, url, json({ status: "ok", service: "glorp-station" }));
      }

      try {
        return withCors(req, url, await router.route(req, url.pathname));
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
  if (config.dashboard) {
    if (dashboardBuilt(config.dataDir)) {
      console.log(`[glorp-station] dashboard at http://${config.hostname}:${port}/`);
    } else {
      console.log("[glorp-station] dashboard enabled but no built assets found. Looked in:");
      for (const dir of dashboardSearchPaths(config.dataDir)) console.log(`    ${dir}`);
      console.log("[glorp-station]   Fix: `bun run build:dashboard` (then re-run `bun run install-bin` for the binary), or set GLORP_DASHBOARD_DIR.");
    }
  }

  return {
    port,
    manager,
    async stop() {
      await manager.shutdownAll();
      server.stop();
      console.log("[glorp-station] stopped");
    },
  };
}
