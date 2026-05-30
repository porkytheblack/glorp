/**
 * The dashboard's single source of truth: session state derived purely by
 * folding the BridgeEvent stream — the same model the TUI's `useUiState` uses.
 * `session_hydrate` resets to a full snapshot; subsequent events patch it.
 */

import type {
  AgentStats,
  BridgeEvent,
  ChatTurn,
  DisplaySlotEvent,
  InboxEntry,
  PlanDocument,
  TaskItem,
  ToolEvent,
} from "../types.ts";

export interface SessionState {
  hydrated: boolean;
  title: string | null;
  turns: ChatTurn[];
  /** Live agent text being streamed before it lands as a turn. */
  streamingText: string;
  tools: Record<string, ToolEvent>;
  plan: PlanDocument | null;
  tasks: TaskItem[];
  inbox: InboxEntry[];
  stats: AgentStats | null;
  busy: boolean;
  /** Pending display slots — permission prompts and ask_* requests. */
  slots: DisplaySlotEvent[];
  permissionMode: string;
  error: string | null;
}

export const initialSessionState: SessionState = {
  hydrated: false,
  title: null,
  turns: [],
  streamingText: "",
  tools: {},
  plan: null,
  tasks: [],
  inbox: [],
  stats: null,
  busy: false,
  slots: [],
  permissionMode: "normal",
  error: null,
};

export function reduce(state: SessionState, event: BridgeEvent): SessionState {
  switch (event.type) {
    case "session_hydrate":
      return {
        ...initialSessionState,
        hydrated: true,
        title: event.title,
        turns: event.turns,
        plan: event.plan,
        tasks: event.tasks,
        inbox: event.inbox,
        stats: event.stats,
        permissionMode: state.permissionMode,
      };
    case "session_reset":
      return { ...initialSessionState, permissionMode: state.permissionMode };
    case "title":
      return { ...state, title: event.title };
    case "turn":
      return { ...state, turns: [...state.turns, event.turn], streamingText: "" };
    case "turn_update":
      return {
        ...state,
        turns: state.turns.map((t) => (t.id === event.id ? { ...t, ...event.patch } : t)),
      };
    case "text_delta":
      return { ...state, streamingText: state.streamingText + event.text };
    case "text_clear":
      return { ...state, streamingText: "" };
    case "tool_started":
    case "tool_finished":
      return { ...state, tools: { ...state.tools, [event.tool.id]: event.tool } };
    case "busy":
      return { ...state, busy: event.busy };
    case "plan":
      return { ...state, plan: event.plan };
    case "tasks":
      return { ...state, tasks: event.tasks };
    case "inbox":
      return { ...state, inbox: event.items };
    case "stats":
      return { ...state, stats: event.stats };
    case "display_slot_pushed":
      return { ...state, slots: [...state.slots.filter((s) => s.slotId !== event.slot.slotId), event.slot] };
    case "display_slot_resolved":
      return { ...state, slots: state.slots.filter((s) => s.slotId !== event.slotId) };
    case "permission_mode_changed":
      return { ...state, permissionMode: event.mode };
    case "error":
      return { ...state, error: event.message };
    default:
      return state;
  }
}
