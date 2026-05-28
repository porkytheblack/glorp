/**
 * Main Glorp server — HTTP + WebSocket on a single Bun.serve() instance.
 *
 * REST API is at /api/v1/*, WebSocket upgrade is at
 * /api/v1/sessions/:id/ws. Binds to 127.0.0.1 only (dev tool).
 */

import { SessionPool } from "./session-pool.ts";
import { Broadcaster } from "./broadcast.ts";
import { createRouter } from "./router.ts";
import {
  handleWsOpen,
  handleWsMessage,
  handleWsClose,
  makeWsData,
  type WsContext,
  type WsData,
} from "./ws-handler.ts";
import { handleSendMessage } from "./message-endpoint.ts";
import { writeDiscovery, removeDiscovery } from "./discovery.ts";
import { getBridge } from "../shared/bridge.ts";
import { DEFAULT_PORT } from "../protocol/envelope.ts";
import { GLORP_VERSION } from "../shared/version.ts";
import { CredentialsStore } from "../agent/credentials.ts";
import type { SendMessageRequest } from "../protocol/rest.ts";

import type { PermissionMode } from "../agent/runtime/permission-mode.ts";

export interface ServerConfig {
  workspace: string;
  dataDir: string;
  port?: number;
  token?: string;
  provider?: string;
  model?: string;
  permissionMode?: PermissionMode;
}

const WS_PATH_RE = /^\/api\/v1\/sessions\/([^/]+)\/ws$/;
const SESSION_ID_RE = /^\/api\/v1\/sessions\/([^/]+)$/;
const MESSAGE_PATH_RE = /^\/api\/v1\/sessions\/([^/]+)\/message$/;

/** CORS headers for localhost development. */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function withCors(resp: Response): Response {
  for (const [k, v] of Object.entries(CORS)) resp.headers.set(k, v);
  return resp;
}

export async function startServer(
  config: ServerConfig,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const port = config.port ?? DEFAULT_PORT;
  const pool = new SessionPool(config.workspace, config.dataDir, config.provider, config.model, config.permissionMode);
  const broadcaster = new Broadcaster();
  const startedAt = Date.now();
  const credentials = new CredentialsStore(config.dataDir);
  const router = createRouter(
    pool,
    { workspace: config.workspace, dataDir: config.dataDir, port, startedAt },
    credentials,
  );

  // Relay every Bridge event to all connected WebSocket clients.
  const unsubscribe = getBridge().subscribe((event) => broadcaster.broadcast(event));

  const server = Bun.serve<WsData>({
    hostname: "127.0.0.1",
    port,

    async fetch(req, srv) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }

      if (config.token && url.pathname !== "/api/v1/health") {
        const auth = req.headers.get("authorization");
        if (auth !== `Bearer ${config.token}`) {
          return withCors(new Response(
            JSON.stringify({ error: "unauthorized", message: "Invalid or missing token" }),
            { status: 401, headers: { "content-type": "application/json" } },
          ));
        }
      }

      // Synchronous message endpoint for programmatic testing.
      const msgMatch = url.pathname.match(MESSAGE_PATH_RE);
      if (msgMatch && req.method === "POST") {
        try {
          const body = (await req.json()) as SendMessageRequest;
          const { session } = await pool.getOrCreate(msgMatch[1]!);
          const result = await handleSendMessage(session.handle, getBridge(), body);
          return withCors(new Response(JSON.stringify(result), {
            status: result.error && !result.text ? 502 : 200,
            headers: { "content-type": "application/json" },
          }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return withCors(new Response(
            JSON.stringify({ error: "message_failed", message: msg }),
            { status: 500, headers: { "content-type": "application/json" } },
          ));
        }
      }

      // WebSocket upgrade.
      const wsMatch = url.pathname.match(WS_PATH_RE);
      if (wsMatch && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const sessionId = wsMatch[1]!;
        try {
          const { session } = await pool.getOrCreate(sessionId);
          const ctx: WsContext = {
            handle: session.handle,
            broadcaster,
            workspace: config.workspace,
            sessionId: session.id,
          };
          if (srv.upgrade(req, { data: makeWsData(ctx) })) return undefined;
          return new Response("WebSocket upgrade failed", { status: 500 });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return withCors(new Response(
            JSON.stringify({ error: "session_error", message: msg }),
            { status: 500, headers: { "content-type": "application/json" } },
          ));
        }
      }

      return withCors(await routeRest(req, url.pathname, router));
    },

    websocket: {
      open(ws) { handleWsOpen(ws); },
      message(ws, data) { handleWsMessage(ws, data as string); },
      close(ws) { handleWsClose(ws); },
    },
  });

  const actualPort = server.port ?? port;

  await writeDiscovery(config.dataDir, {
    port: actualPort,
    pid: process.pid,
    workspace: config.workspace,
    version: GLORP_VERSION,
    startedAt: new Date(startedAt).toISOString(),
  });

  console.log(`[glorp-server] listening on 127.0.0.1:${actualPort} (workspace: ${config.workspace})`);

  return {
    port: actualPort,
    async stop() {
      unsubscribe();
      await pool.shutdownAll();
      server.stop();
      await removeDiscovery(config.dataDir);
      console.log("[glorp-server] stopped");
    },
  };
}

async function routeRest(
  req: Request,
  pathname: string,
  router: ReturnType<typeof createRouter>,
): Promise<Response> {
  if (pathname === "/api/v1/health" && req.method === "GET") return router.health();
  if (pathname === "/api/v1/sessions" && req.method === "POST") return router.createSession(req);
  if (pathname === "/api/v1/sessions" && req.method === "GET") return router.listSessions();
  if (pathname === "/api/v1/profiles" && req.method === "GET") return router.listProfiles();

  const sessionMatch = pathname.match(SESSION_ID_RE);
  if (sessionMatch) {
    const id = sessionMatch[1]!;
    if (req.method === "GET") return router.getSession(id);
    if (req.method === "DELETE") return router.deleteSession(id);
    return new Response("Method not allowed", { status: 405 });
  }

  return new Response(
    JSON.stringify({ error: "not_found", message: `No route: ${req.method} ${pathname}` }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
}
