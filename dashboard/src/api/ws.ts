/**
 * Session WebSocket connection. Connects to `/sessions/:id/events`, parses the
 * `{ sessionId, seq, event }` envelope, and surfaces each BridgeEvent plus a
 * gap signal (when `seq` skips, the consumer should request a re-hydrate).
 * Auto-reconnects with backoff.
 */

import type { BridgeEvent, EventEnvelope } from "../types.ts";

export interface SessionSocketHandlers {
  onEvent: (event: BridgeEvent) => void;
  onStatus?: (status: "connecting" | "open" | "closed") => void;
  onGap?: () => void;
}

function wsUrl(sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/sessions/${sessionId}/events`;
}

export function connectSession(sessionId: string, handlers: SessionSocketHandlers): () => void {
  let socket: WebSocket | null = null;
  let closedByUs = false;
  let retry = 0;
  let lastSeq = 0;

  const open = () => {
    handlers.onStatus?.("connecting");
    socket = new WebSocket(wsUrl(sessionId));

    socket.onopen = () => {
      retry = 0;
      handlers.onStatus?.("open");
    };

    socket.onmessage = (ev) => {
      let env: EventEnvelope;
      try {
        env = JSON.parse(ev.data as string) as EventEnvelope;
      } catch {
        return;
      }
      if (!env || typeof env.seq !== "number" || !env.event) return;
      if (lastSeq && env.seq > lastSeq + 1) handlers.onGap?.();
      lastSeq = env.seq;
      handlers.onEvent(env.event);
    };

    socket.onclose = () => {
      handlers.onStatus?.("closed");
      if (closedByUs) return;
      retry += 1;
      const delay = Math.min(1000 * 2 ** (retry - 1), 10_000);
      setTimeout(open, delay);
    };

    socket.onerror = () => socket?.close();
  };

  open();

  return () => {
    closedByUs = true;
    socket?.close();
  };
}

/** Send a command back over the socket (optional convenience for the UI). */
export function sendCommand(socket: WebSocket | null, command: Record<string, unknown>): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
}
