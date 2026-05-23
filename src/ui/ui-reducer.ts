import type { ChatTurn } from "../shared/events.ts";
import { INITIAL_UI_STATE, moodFrom, type Action, type UiState } from "./ui-state.ts";

/** Pure reducer. Mood is recomputed once at the end so every case touches it. */
export function reduce(state: UiState, action: Action): UiState {
  const next = applyAction(state, action);
  return next === state ? state : { ...next, mood: moodFrom(next) };
}

function applyAction(state: UiState, action: Action): UiState {
  switch (action.kind) {
    case "hydrate":
      return { ...state, turns: action.turns, title: action.title, streamingText: "", displaySlots: [] };
    case "turn":
      return { ...state, turns: [...state.turns, action.turn] };
    case "title":
      return { ...state, title: action.title };
    case "turn_update":
      return {
        ...state,
        turns: state.turns.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };
    case "text_delta":
      return state.compacting ? state : { ...state, streamingText: state.streamingText + action.text };
    case "text_clear":
      return { ...state, streamingText: "" };
    case "tool_started": {
      const turn: ChatTurn = { id: `t_${action.tool.id}`, kind: "tool", tool: action.tool, createdAt: Date.now() };
      return { ...state, turns: [...state.turns, turn] };
    }
    case "tool_finished":
      return {
        ...state,
        turns: state.turns.map((t) =>
          t.kind === "tool" && t.tool?.id === action.tool.id ? { ...t, tool: action.tool } : t,
        ),
      };
    case "busy":
      return { ...state, busy: action.busy, lastError: action.busy ? undefined : state.lastError };
    case "tasks":
      return { ...state, tasks: action.tasks };
    case "inbox":
      return { ...state, inbox: action.items };
    case "stats":
      return { ...state, stats: action.stats };
    case "compaction":
      return {
        ...state,
        compacting: action.phase === "start",
        streamingText: action.phase === "start" ? "" : state.streamingText,
      };
    case "subagent": {
      const active =
        action.phase === "start"
          ? [...state.activeSubagents, action.name]
          : state.activeSubagents.filter((n, i, arr) => i !== arr.lastIndexOf(action.name));
      return { ...state, activeSubagents: active };
    }
    case "transmission": {
      const t = { payload: action.payload, severity: action.severity, at: Date.now() };
      return { ...state, transmissions: [...state.transmissions, t].slice(-40) };
    }
    case "extension":
      return { ...state, lastExtension: { kind: action.ext, name: action.name, at: Date.now() } };
    case "display_slot_pushed":
      return { ...state, displaySlots: [...state.displaySlots, action.slot] };
    case "display_slot_resolved":
      return { ...state, displaySlots: state.displaySlots.filter((r) => r.slotId !== action.slotId) };
    case "fleet_job":
      return action.job.status === "running"
        ? { ...state, fleetJobs: [...state.fleetJobs, action.job] }
        : { ...state, fleetJobs: state.fleetJobs.filter((j) => j.jobId !== action.job.jobId) };
    case "session_reset":
      return { ...INITIAL_UI_STATE, transmissions: state.transmissions };
    case "error":
      return { ...state, lastError: action.message };
  }
}
