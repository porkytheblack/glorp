/**
 * The single-session Glorp server as a Hono app. REST lives under /api/v1/*,
 * the WebSocket upgrade at /api/v1/sessions/:id/ws, and a synchronous message
 * endpoint at /api/v1/sessions/:id/message. CORS is permissive (localhost dev
 * tool); a shared Bearer token may gate everything but /health.
 */

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import type { SessionPool } from "./session-pool.ts";
import type { Broadcaster } from "./broadcast.ts";
import type { createRouter } from "./router.ts";
import {
  handleWsOpen,
  handleWsMessage,
  handleWsClose,
  makeWsData,
  type WsContext,
  type WsData,
} from "./ws-handler.ts";
import { handleSendMessage } from "./message-endpoint.ts";
import { getBridge } from "../shared/bridge.ts";
import type { SendMessageRequest } from "../protocol/rest.ts";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function withCors(resp: Response): Response {
  for (const [k, v] of Object.entries(CORS)) resp.headers.set(k, v);
  return resp;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface ServerAppDeps {
  pool: SessionPool;
  broadcaster: Broadcaster;
  router: ReturnType<typeof createRouter>;
  workspace: string;
  token?: string;
}

/** A WSContext adapter so the Bun-shaped ws-handler can drive a Hono socket. */
type WsLike = {
  data: WsData;
  send: (d: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
};

export function buildServerApp(deps: ServerAppDeps) {
  const { pool, broadcaster, router, workspace, token } = deps;
  const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();
  const app = new Hono<{ Variables: { wsCtx: WsContext } }>();

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (token && c.req.path !== "/api/v1/health") {
      if (c.req.header("authorization") !== `Bearer ${token}`) {
        return withCors(jsonResponse({ error: "unauthorized", message: "Invalid or missing token" }, 401));
      }
    }
    await next();
    if (c.res && c.req.header("upgrade")?.toLowerCase() !== "websocket") c.res = withCors(c.res);
  });

  app.post("/api/v1/sessions/:id/message", async (c) => {
    try {
      const body = (await c.req.json()) as SendMessageRequest;
      const { session } = await pool.getOrCreate(c.req.param("id"));
      const result = await handleSendMessage(session.handle, getBridge(), body);
      return jsonResponse(result, result.error && !result.text ? 502 : 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: "message_failed", message: msg }, 500);
    }
  });

  app.get(
    "/api/v1/sessions/:id/ws",
    async (c, next) => {
      try {
        const { session } = await pool.getOrCreate(c.req.param("id"));
        c.set("wsCtx", { handle: session.handle, broadcaster, workspace, sessionId: session.id });
        return next();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: "session_error", message: msg }, 500);
      }
    },
    upgradeWebSocket((c) => {
      const data = makeWsData(c.get("wsCtx") as WsContext);
      // Read the LIVE socket state via `ws.raw` (hono's WSContext.readyState is
      // a per-event snapshot) so the broadcaster's dead-client guard stays accurate.
      type RawWs = { send: (d: string) => void; close: (c?: number, r?: string) => void; readyState: number; raw?: { readyState: number } };
      const wrap = (ws: RawWs): WsLike => ({
        data,
        send: (d) => ws.send(d),
        close: (code, reason) => ws.close(code, reason),
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

  app.all("*", async (c) => {
    const p = c.req.path;
    const m = c.req.method;
    if (p === "/api/v1/health" && m === "GET") return router.health();
    if (p === "/api/v1/sessions" && m === "POST") return router.createSession(c.req.raw);
    if (p === "/api/v1/sessions" && m === "GET") return router.listSessions();
    if (p === "/api/v1/profiles" && m === "GET") return router.listProfiles();
    const sm = p.match(/^\/api\/v1\/sessions\/([^/]+)$/);
    if (sm) {
      if (m === "GET") return router.getSession(sm[1]!);
      if (m === "DELETE") return router.deleteSession(sm[1]!);
      return new Response("Method not allowed", { status: 405 });
    }
    return jsonResponse({ error: "not_found", message: `No route: ${m} ${p}` }, 404);
  });

  return { app, websocket };
}
