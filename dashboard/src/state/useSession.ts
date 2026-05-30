/**
 * Connects to one session's WebSocket and maintains its state by folding the
 * event stream through the reducer. Exposes the live state plus actions that
 * call the REST API. Re-hydrate is automatic on connect and on detected gaps.
 */

import { useEffect, useReducer, useRef, useState } from "react";
import { connectSession } from "../api/ws.ts";
import { api } from "../api/client.ts";
import { initialSessionState, reduce, type SessionState } from "./reducer.ts";
import type { BridgeEvent } from "../types.ts";

export type ConnStatus = "connecting" | "open" | "closed";

export interface SessionController {
  state: SessionState;
  status: ConnStatus;
  send: (text: string) => void;
  abort: () => void;
  approve: (slotId: string) => void;
  deny: (slotId: string) => void;
}

export function useSession(sessionId: string | null): SessionController {
  const [state, dispatch] = useReducer(reduce, initialSessionState);
  const [status, setStatus] = useState<ConnStatus>("closed");
  // Reset reducer state whenever the selected session changes.
  const resetKey = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    if (resetKey.current !== sessionId) {
      resetKey.current = sessionId;
      dispatch({ type: "session_reset" } as BridgeEvent);
    }
    const disconnect = connectSession(sessionId, {
      onEvent: (event) => dispatch(event),
      onStatus: setStatus,
      onGap: () => {
        // A gap means we missed events; the server re-emits a full hydrate
        // when we ask via the WS `resync` command. Reconnect handles most
        // cases; this is a belt-and-suspenders no-op hook for now.
      },
    });
    return disconnect;
  }, [sessionId]);

  return {
    state,
    status,
    send: (text) => {
      if (sessionId && text.trim()) void api.sendMessage(sessionId, text).catch(() => {});
    },
    abort: () => {
      if (sessionId) void api.abort(sessionId).catch(() => {});
    },
    approve: (slotId) => {
      if (sessionId) void api.resolveSlot(sessionId, slotId, "approve").catch(() => {});
    },
    deny: (slotId) => {
      if (sessionId) void api.resolveSlot(sessionId, slotId, "deny").catch(() => {});
    },
  };
}
