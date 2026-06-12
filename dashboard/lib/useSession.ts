"use client";

/**
 * Live session model. Subscribes to the Garage session WebSocket, requests a
 * full hydrate on open, and folds the event stream into a render-ready
 * conversation: ordered turns, a streaming buffer, tasks, stats, the agent
 * roster, and any open permission/display slots. Also exposes the inbound
 * commands the chat needs (send, abort, resolve permission, switch agent…).
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { sessionWsUrl } from "./api";
import type { ChatTurn, ToolEvent, TaskItem, SessionStats, DisplaySlot, AgentInfo } from "./types";

interface State {
  items: ChatTurn[];
  streaming: string;
  busy: boolean;
  title: string | null;
  tasks: TaskItem[];
  stats: SessionStats | null;
  agents: AgentInfo[];
  activeAgentId: string | null;
  mode: string | null;
  slots: DisplaySlot[];
  /** Honest status: seconds the model has been silent (null = streaming fine). */
  waitingSec: number | null;
  /** Messages queued behind the running turn. */
  queueDepth: number;
}

const INIT: State = {
  items: [],
  streaming: "",
  busy: false,
  title: null,
  tasks: [],
  stats: null,
  agents: [],
  activeAgentId: null,
  mode: null,
  slots: [],
  waitingSec: null,
  queueDepth: 0,
};

type Ev = { type: string; [k: string]: any };

function upsert(items: ChatTurn[], turn: ChatTurn): ChatTurn[] {
  const i = items.findIndex((t) => t.id === turn.id);
  if (i === -1) return [...items, turn];
  const next = items.slice();
  next[i] = { ...next[i], ...turn };
  return next;
}

function reduce(state: State, ev: Ev): State {
  switch (ev.type) {
    case "session_hydrate":
      // Open display slots are replayed as display_slot_pushed events right
      // after the hydrate — reset here so stale slots from before a reconnect
      // don't linger. Error turns arrive again right after (the session
      // replays recent errors on every hydrate), so a plain reset stays
      // duplicate-free.
      return {
        ...state,
        items: (ev.turns ?? []) as ChatTurn[],
        title: ev.title ?? state.title,
        tasks: ev.tasks ?? [],
        stats: ev.stats ?? state.stats,
        slots: [],
      };
    case "session_reset":
      return { ...state, items: [], streaming: "", tasks: [] };
    case "turn":
      return {
        ...state,
        items: upsert(state.items, ev.turn as ChatTurn),
        streaming: ev.turn?.kind === "agent" ? "" : state.streaming,
      };
    case "turn_update":
      return { ...state, items: state.items.map((t) => (t.id === ev.id ? { ...t, ...(ev.patch ?? {}) } : t)) };
    case "text_delta":
      return { ...state, streaming: state.streaming + (ev.text ?? "") };
    case "text_clear":
      return { ...state, streaming: "" };
    case "tool_started":
    case "tool_finished": {
      const tool = ev.tool as ToolEvent;
      return { ...state, items: upsert(state.items, { id: tool.id, kind: "tool", tool, createdAt: tool.startedAt ?? Date.now() }) };
    }
    case "tasks":
      return { ...state, tasks: ev.tasks ?? [] };
    case "stats":
      return { ...state, stats: ev.stats ?? state.stats };
    case "title":
      return { ...state, title: ev.title ?? null };
    case "busy":
      return { ...state, busy: Boolean(ev.busy), ...(ev.busy ? {} : { waitingSec: null }) };
    case "agent_roster":
      return { ...state, agents: ev.agents ?? [], activeAgentId: ev.activeId ?? null };
    case "permission_mode_changed":
      return { ...state, mode: ev.mode ?? state.mode };
    case "display_slot_pushed": {
      // Upsert: the server replays open slots on hydrate/resync.
      const slot = ev.slot as DisplaySlot;
      return { ...state, slots: [...state.slots.filter((s) => s.slotId !== slot.slotId), slot] };
    }
    case "display_slot_resolved":
      return { ...state, slots: state.slots.filter((s) => s.slotId !== ev.slotId) };
    case "error":
      return {
        ...state,
        waitingSec: null,
        items: [
          ...state.items,
          {
            id: `err_${Date.now()}`,
            kind: "system",
            text: ev.message,
            error: true,
            createdAt: Date.now(),
            meta: { kind: ev.kind, hint: ev.hint, retryAfterSec: ev.retryAfterSec, detail: ev.detail },
          },
        ],
      };
    case "model_status":
      return { ...state, waitingSec: ev.state === "waiting" ? (ev.elapsedSec ?? 0) : null };
    case "queue_depth":
      return { ...state, queueDepth: ev.depth ?? 0 };
    default:
      return state;
  }
}

export function useSession(id: string) {
  const [state, dispatch] = useReducer(reduce, INIT);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!id) return;
    const ws = new WebSocket(sessionWsUrl(id));
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "resync" }));
    };
    ws.onclose = () => setConnected(false);
    let wasBusy = false;
    ws.onmessage = (e) => {
      try {
        const env = JSON.parse(String(e.data));
        const ev = env.event ?? env;
        dispatch(ev);
        // A finished turn may include work from before this client connected
        // (the launch flow posts the first message before navigating) — pull a
        // fresh hydrate so the transcript is always complete. Only on the
        // busy true→false TRANSITION: hydrate itself re-emits the current
        // busy state, so resyncing on every busy:false would loop forever.
        if (ev.type === "busy") {
          if (wasBusy && ev.busy === false) ws.send(JSON.stringify({ type: "resync" }));
          wasBusy = Boolean(ev.busy);
        }
      } catch {
        /* ignore non-JSON frames */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [id]);

  const raw = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    // Click handlers (slot resolves, abort…) survive a dropped socket: send()
    // on a non-OPEN socket throws. Open slots replay on reconnect anyway.
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);
  const send = useCallback(
    (text: string, images?: Array<{ data: string; media_type: string }>) =>
      (text.trim() || images?.length) &&
      raw({ type: "send_message", text: text.trim(), ...(images?.length ? { images } : {}) }),
    [raw],
  );
  const abort = useCallback(() => raw({ type: "abort" }), [raw]);
  const resolvePermission = useCallback((slotId: string, allow: boolean) => raw({ type: "resolve_permission", slot_id: slotId, allow }), [raw]);
  const resolveSlot = useCallback((slotId: string, value: unknown) => raw({ type: "resolve_slot", slot_id: slotId, value }), [raw]);
  const rejectSlot = useCallback((slotId: string, reason?: string) => raw({ type: "reject_slot", slot_id: slotId, ...(reason ? { reason } : {}) }), [raw]);
  const setMode = useCallback((mode: string) => raw({ type: "set_permission_mode", mode }), [raw]);
  const swapProfile = useCallback((profileId: string) => raw({ type: "swap_profile", profile_id: profileId }), [raw]);
  const switchAgent = useCallback((agentId: string) => raw({ type: "switch_agent", agent_id: agentId }), [raw]);
  const addAgent = useCallback((role: string, label?: string) => raw({ type: "add_agent", role, label }), [raw]);
  const removeAgent = useCallback((agentId: string) => raw({ type: "remove_agent", agent_id: agentId }), [raw]);

  return { ...state, connected, send, abort, resolvePermission, resolveSlot, rejectSlot, setMode, swapProfile, switchAgent, addAgent, removeAgent };
}

export type SessionLive = ReturnType<typeof useSession>;
