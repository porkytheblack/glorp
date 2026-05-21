import { useEffect, useReducer, useRef } from "react";
import { getBridge } from "../shared/bridge.ts";
import type {
  ChatTurn,
  TaskItem,
  InboxEntry,
  AgentStats,
  ToolEvent,
  DisplaySlotEvent,
} from "../shared/events.ts";

export interface UiState {
  turns: ChatTurn[];
  streamingText: string;
  busy: boolean;
  tasks: TaskItem[];
  inbox: InboxEntry[];
  stats: AgentStats;
  compacting: boolean;
  activeSubagents: string[];
  transmissions: Array<{
    payload: string;
    severity: "low" | "medium" | "high";
    at: number;
  }>;
  /** Most recent hook/skill invocation, for transient status display. */
  lastExtension?: { kind: "hook" | "skill"; name: string; at: number };
  /** Pending display-stack slots waiting for the user. FIFO. */
  displaySlots: DisplaySlotEvent[];
  lastError?: string;
  mood: "idle" | "thinking" | "working" | "speaking" | "glitched" | "error";
}

type Action =
  | { kind: "turn"; turn: ChatTurn }
  | { kind: "turn_update"; id: string; patch: Partial<ChatTurn> }
  | { kind: "text_delta"; text: string }
  | { kind: "text_clear" }
  | { kind: "tool_started"; tool: ToolEvent }
  | { kind: "tool_finished"; tool: ToolEvent }
  | { kind: "busy"; busy: boolean }
  | { kind: "tasks"; tasks: TaskItem[] }
  | { kind: "inbox"; items: InboxEntry[] }
  | { kind: "stats"; stats: AgentStats }
  | { kind: "compaction"; phase: "start" | "end" }
  | { kind: "subagent"; name: string; phase: "start" | "end" }
  | { kind: "transmission"; payload: string; severity: "low" | "medium" | "high" }
  | { kind: "extension"; ext: "hook" | "skill"; name: string }
  | { kind: "display_slot_pushed"; slot: DisplaySlotEvent }
  | { kind: "display_slot_resolved"; slotId: string }
  | { kind: "session_reset" }
  | { kind: "error"; message: string };

const initial: UiState = {
  turns: [],
  streamingText: "",
  busy: false,
  tasks: [],
  inbox: [],
  stats: { turns: 0, tokens_in: 0, tokens_out: 0, contextPct: 0 },
  compacting: false,
  activeSubagents: [],
  transmissions: [],
  displaySlots: [],
  mood: "idle",
};

function moodFrom(s: UiState): UiState["mood"] {
  if (s.lastError) return "error";
  if (s.compacting) return "thinking";
  if (s.activeSubagents.length > 0) return "working";
  if (s.busy && s.streamingText) return "speaking";
  if (s.busy) return "working";
  // Glitch occasionally on high-severity transmissions.
  const recentHigh = s.transmissions.find(
    (t) => t.severity === "high" && Date.now() - t.at < 2500,
  );
  if (recentHigh) return "glitched";
  return "idle";
}

function reduce(state: UiState, action: Action): UiState {
  let next = state;
  switch (action.kind) {
    case "turn":
      next = { ...state, turns: [...state.turns, action.turn] };
      break;
    case "turn_update":
      next = {
        ...state,
        turns: state.turns.map((t) =>
          t.id === action.id ? { ...t, ...action.patch } : t,
        ),
      };
      break;
    case "text_delta":
      next = { ...state, streamingText: state.streamingText + action.text };
      break;
    case "text_clear":
      next = { ...state, streamingText: "" };
      break;
    case "tool_started": {
      const turn: ChatTurn = {
        id: `t_${action.tool.id}`,
        kind: "tool",
        tool: action.tool,
        createdAt: Date.now(),
      };
      next = { ...state, turns: [...state.turns, turn] };
      break;
    }
    case "tool_finished":
      next = {
        ...state,
        turns: state.turns.map((t) =>
          t.kind === "tool" && t.tool?.id === action.tool.id
            ? { ...t, tool: action.tool }
            : t,
        ),
      };
      break;
    case "busy":
      next = { ...state, busy: action.busy, lastError: action.busy ? undefined : state.lastError };
      break;
    case "tasks":
      next = { ...state, tasks: action.tasks };
      break;
    case "inbox":
      next = { ...state, inbox: action.items };
      break;
    case "stats":
      next = { ...state, stats: action.stats };
      break;
    case "compaction":
      next = { ...state, compacting: action.phase === "start" };
      break;
    case "subagent": {
      const active =
        action.phase === "start"
          ? [...state.activeSubagents, action.name]
          : state.activeSubagents.filter((n, i, arr) => {
              const idx = arr.lastIndexOf(action.name);
              return i !== idx;
            });
      next = { ...state, activeSubagents: active };
      break;
    }
    case "transmission": {
      const t = { payload: action.payload, severity: action.severity, at: Date.now() };
      next = { ...state, transmissions: [...state.transmissions, t].slice(-40) };
      break;
    }
    case "extension":
      next = { ...state, lastExtension: { kind: action.ext, name: action.name, at: Date.now() } };
      break;
    case "display_slot_pushed":
      next = {
        ...state,
        displaySlots: [...state.displaySlots, action.slot],
      };
      break;
    case "display_slot_resolved":
      next = {
        ...state,
        displaySlots: state.displaySlots.filter((r) => r.slotId !== action.slotId),
      };
      break;
    case "session_reset":
      // Used by the session-swap path; wipe accumulated state so the new
      // agent's snapshot drives a fresh transcript.
      next = {
        ...initial,
        // Preserve cross-session UI bits (transmissions are global, not per-session).
        transmissions: state.transmissions,
      };
      break;
    case "error":
      next = { ...state, lastError: action.message };
      break;
  }
  return { ...next, mood: moodFrom(next) };
}

export function useUiState(): UiState {
  const [state, dispatch] = useReducer(reduce, initial);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const bridge = getBridge();
    const unsubscribe = bridge.subscribe((ev) => {
      switch (ev.type) {
        case "turn":
          dispatchRef.current({ kind: "turn", turn: ev.turn });
          break;
        case "turn_update":
          dispatchRef.current({ kind: "turn_update", id: ev.id, patch: ev.patch });
          break;
        case "text_delta":
          dispatchRef.current({ kind: "text_delta", text: ev.text });
          break;
        case "text_clear":
          dispatchRef.current({ kind: "text_clear" });
          break;
        case "tool_started":
          dispatchRef.current({ kind: "tool_started", tool: ev.tool });
          break;
        case "tool_finished":
          dispatchRef.current({ kind: "tool_finished", tool: ev.tool });
          break;
        case "busy":
          dispatchRef.current({ kind: "busy", busy: ev.busy });
          break;
        case "tasks":
          dispatchRef.current({ kind: "tasks", tasks: ev.tasks });
          break;
        case "inbox":
          dispatchRef.current({ kind: "inbox", items: ev.items });
          break;
        case "stats":
          dispatchRef.current({ kind: "stats", stats: ev.stats });
          break;
        case "compaction":
          dispatchRef.current({ kind: "compaction", phase: ev.phase });
          break;
        case "subagent":
          dispatchRef.current({ kind: "subagent", name: ev.name, phase: ev.phase });
          break;
        case "transmission":
          dispatchRef.current({
            kind: "transmission",
            payload: ev.payload,
            severity: ev.severity,
          });
          break;
        case "hook":
          dispatchRef.current({ kind: "extension", ext: "hook", name: ev.name });
          break;
        case "skill":
          dispatchRef.current({ kind: "extension", ext: "skill", name: ev.name });
          break;
        case "display_slot_pushed":
          dispatchRef.current({ kind: "display_slot_pushed", slot: ev.slot });
          break;
        case "display_slot_resolved":
          dispatchRef.current({ kind: "display_slot_resolved", slotId: ev.slotId });
          break;
        case "session_reset":
          dispatchRef.current({ kind: "session_reset" });
          break;
        case "error":
          dispatchRef.current({ kind: "error", message: ev.message });
          break;
      }
    });
    // Wrap so the effect returns `() => void`, not `() => boolean`.
    return () => {
      unsubscribe();
    };
  }, []);
  return state;
}
