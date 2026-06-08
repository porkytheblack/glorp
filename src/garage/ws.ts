/**
 * Garage WebSocket lifecycle. Each connection subscribes to exactly one
 * session's event stream. On connect the client is hydrated with full session
 * state; thereafter it receives the live `{ sessionId, seq, event }` stream and
 * may push a small set of commands back over the same socket.
 */

import type { ServerWebSocket } from "bun";
import type { GarageSession } from "./session.ts";
import type { StreamClient } from "./event-stream.ts";

export interface WsData {
  session: GarageSession;
  clientId: string;
  client: StreamClient | null;
}

let counter = 0;
function nextClientId(): string {
  return `c_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

/** Build the data attached to a connection at upgrade time. */
export function makeWsData(session: GarageSession): WsData {
  return { session, clientId: nextClientId(), client: null };
}

export function handleWsOpen(ws: ServerWebSocket<WsData>): void {
  const data = ws.data;
  const client: StreamClient = {
    id: data.clientId,
    send: (d) => ws.send(d),
    get readyState() {
      return ws.readyState;
    },
    seq: 0,
  };
  data.client = client;
  data.session.stream.add(client);
  // Build the agent if needed and replay full state to all clients.
  void data.session.hydrate().catch((err) => data.session.fail(err));
}

export function handleWsClose(ws: ServerWebSocket<WsData>): void {
  ws.data.session.stream.remove(ws.data.clientId);
}

export function handleWsMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
  const text = typeof raw === "string" ? raw : raw.toString("utf-8");
  let msg: { type?: string; [k: string]: unknown };
  try {
    msg = JSON.parse(text) as typeof msg;
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== "string") return;
  void dispatch(ws.data.session, msg);
}

/** Route a parsed client command to the session. Read-mostly; commands optional. */
async function dispatch(
  session: GarageSession,
  msg: { type?: string; [k: string]: unknown },
): Promise<void> {
  switch (msg.type) {
    case "send_message":
      void session.send(String(msg.text ?? ""), msg.images as never);
      return;
    case "resync":
      await session.hydrate().catch((err) => session.fail(err));
      return;
  }
  // Remaining commands act on the live handle. If a client connects and fires
  // one before hydrate() finishes building, build it now so the command isn't
  // silently dropped to the race.
  const handle = session.current() ?? (await session.ensureBuilt().catch(() => null));
  if (!handle) return;
  switch (msg.type) {
    case "abort":
      handle.abort();
      break;
    case "resolve_permission":
      handle.resolvePermission(String(msg.slot_id), Boolean(msg.allow));
      break;
    case "resolve_slot":
      handle.resolveSlot(String(msg.slot_id), msg.value);
      break;
    case "reject_slot":
      handle.rejectSlot(String(msg.slot_id), msg.reason as string | undefined);
      break;
    case "set_permission_mode":
      handle.setPermissionMode(msg.mode as never);
      break;
    case "swap_profile":
      await handle.swapProfile(String(msg.profile_id)).catch(() => {});
      break;
    case "switch_agent":
      await handle.switchAgent(String(msg.agent_id)).catch(() => {});
      break;
    case "add_agent":
      await handle.addAgent({ role: String(msg.role), label: msg.label as string | undefined }).catch(() => {});
      break;
    case "remove_agent":
      await handle.removeAgent(String(msg.agent_id)).catch(() => {});
      break;
  }
}
