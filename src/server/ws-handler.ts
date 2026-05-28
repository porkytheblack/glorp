/**
 * WebSocket connection lifecycle handlers.
 *
 * Each connection goes through: open -> server_hello -> client_hello -> active.
 * If client_hello is not received within 5 seconds, the connection is closed.
 */

import type { ServerWebSocket } from "bun";
import { PROTOCOL_VERSION, WS_CLOSE } from "../protocol/envelope.ts";
import type { ClientMessage, ClientHello } from "../protocol/commands.ts";
import type { GlorpHandle } from "../agent/glorp-types.ts";
import type { Broadcaster, WsClient } from "./broadcast.ts";
import { GLORP_VERSION } from "../shared/version.ts";
import { dispatchCommand } from "./dispatch.ts";

export interface WsContext {
  handle: GlorpHandle;
  broadcaster: Broadcaster;
  workspace: string;
  sessionId: string;
}

export interface WsData {
  ctx: WsContext;
  clientId: string;
  authenticated: boolean;
  helloTimer: ReturnType<typeof setTimeout> | null;
}

/** Send a JSON message directly to a single websocket. */
function sendJson(ws: ServerWebSocket<WsData>, msg: Record<string, unknown>): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket already closed or errored — nothing to do.
  }
}

/**
 * Called when a new WebSocket connection opens.
 * Sends server_hello and starts a 5-second handshake timer.
 */
export function handleWsOpen(ws: ServerWebSocket<WsData>): void {
  const data = ws.data;
  const { ctx } = data;

  sendJson(ws, {
    type: "server_hello",
    protocol_version: PROTOCOL_VERSION,
    server_version: GLORP_VERSION,
    session_id: ctx.sessionId,
    workspace: ctx.workspace,
    peer_count: ctx.broadcaster.clientCount,
    model_label: ctx.handle.modelLabel || undefined,
    permission_mode: ctx.handle.permissionMode,
    seq: 0,
    ts: new Date().toISOString(),
  });

  data.helloTimer = setTimeout(() => {
    if (!data.authenticated) {
      ws.close(WS_CLOSE.NO_HELLO, "client_hello not received within 5 seconds");
    }
  }, 5000);
}

/** Called when a WebSocket message arrives. */
export function handleWsMessage(
  ws: ServerWebSocket<WsData>,
  raw: string | Buffer,
): void {
  const data = ws.data;
  const text = typeof raw === "string" ? raw : raw.toString("utf-8");

  let msg: ClientMessage;
  try {
    msg = JSON.parse(text) as ClientMessage;
  } catch {
    sendJson(ws, {
      type: "protocol_error",
      message: "Invalid JSON",
      seq: 0,
      ts: new Date().toISOString(),
    });
    return;
  }

  if (!msg || typeof msg.type !== "string") {
    sendJson(ws, {
      type: "protocol_error",
      message: "Missing 'type' field",
      seq: 0,
      ts: new Date().toISOString(),
    });
    return;
  }

  if (msg.type === "client_hello") {
    handleClientHello(ws, msg as ClientHello);
    return;
  }

  if (!data.authenticated) {
    ws.close(WS_CLOSE.PROTOCOL_ERROR, "Must send client_hello first");
    return;
  }

  dispatchCommand(msg, data.ctx.handle);
}

function handleClientHello(
  ws: ServerWebSocket<WsData>,
  msg: ClientHello,
): void {
  const data = ws.data;

  if (data.helloTimer) {
    clearTimeout(data.helloTimer);
    data.helloTimer = null;
  }

  if (msg.protocol_version !== PROTOCOL_VERSION) {
    ws.close(
      WS_CLOSE.VERSION_MISMATCH,
      `Protocol version mismatch: server=${PROTOCOL_VERSION}, client=${msg.protocol_version}`,
    );
    return;
  }

  data.clientId = msg.client_id || data.clientId;
  data.authenticated = true;

  const client: WsClient = {
    id: data.clientId,
    name: msg.client_name,
    ws: ws as unknown as WsClient["ws"],
    seq: 0,
  };

  data.ctx.broadcaster.addClient(client);
  data.ctx.broadcaster.broadcastPeerEvent("peer_joined", data.clientId);

  // Hydrate this client with the current session state.
  void data.ctx.handle.hydrateUi();
}

/** Called when a WebSocket connection closes. */
export function handleWsClose(ws: ServerWebSocket<WsData>): void {
  const data = ws.data;

  if (data.helloTimer) {
    clearTimeout(data.helloTimer);
    data.helloTimer = null;
  }

  if (data.authenticated) {
    data.ctx.broadcaster.removeClient(data.clientId);
    data.ctx.broadcaster.broadcastPeerEvent("peer_left", data.clientId);
  }
}

/**
 * Create the initial WsData attached to each connection at upgrade time.
 * Bun stores this on `ws.data` for the lifetime of the connection.
 */
export function makeWsData(ctx: WsContext): WsData {
  return {
    ctx,
    clientId: `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    authenticated: false,
    helloTimer: null,
  };
}
