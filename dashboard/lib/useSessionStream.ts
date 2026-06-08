"use client";

/** Subscribe to a session's WebSocket event stream and keep a rolling buffer. */

import { useEffect, useRef, useState } from "react";
import { sessionWsUrl } from "./api";
import type { EventEnvelope } from "./types";

export interface StreamState {
  events: EventEnvelope["event"][];
  connected: boolean;
  send: (msg: Record<string, unknown>) => void;
}

const MAX_EVENTS = 300;

export function useSessionStream(sessionId: string | null): StreamState {
  const [events, setEvents] = useState<EventEnvelope["event"][]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const ws = new WebSocket(sessionWsUrl(sessionId));
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const env = JSON.parse(String(e.data)) as EventEnvelope;
        const ev = env.event ?? (env as unknown as EventEnvelope["event"]);
        setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), ev]);
      } catch {
        // ignore non-JSON frames
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const send = (msg: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify(msg));
  };

  return { events, connected, send };
}
