import type {
  AgentStats,
  ChatTurn,
  DisplaySlotEvent,
  FleetJobEvent,
  InboxEntry,
  PlanDocument,
  TaskItem,
  ToolEvent,
} from "../shared/events.ts";

export interface UiState {
  turns: ChatTurn[];
  streamingText: string;
  busy: boolean;
  plan: PlanDocument | null;
  tasks: TaskItem[];
  inbox: InboxEntry[];
  fleetJobs: FleetJobEvent[];
  stats: AgentStats;
  compacting: boolean;
  activeSubagents: string[];
  transmissions: Array<{
    payload: string;
    severity: "low" | "medium" | "high";
    at: number;
  }>;
  lastExtension?: { kind: "hook" | "skill"; name: string; at: number };
  displaySlots: DisplaySlotEvent[];
  lastError?: string;
  mood: "idle" | "thinking" | "working" | "speaking" | "glitched" | "error";
}

export type UiAction =
  | {
    kind: "session_hydrate";
    turns: ChatTurn[];
    plan: PlanDocument | null;
    tasks: TaskItem[];
    inbox: InboxEntry[];
    stats: AgentStats;
  }
  | { kind: "turn"; turn: ChatTurn }
  | { kind: "turn_update"; id: string; patch: Partial<ChatTurn> }
  | { kind: "text_delta"; text: string }
  | { kind: "text_clear" }
  | { kind: "tool_started"; tool: ToolEvent }
  | { kind: "tool_finished"; tool: ToolEvent }
  | { kind: "busy"; busy: boolean }
  | { kind: "plan"; plan: PlanDocument | null }
  | { kind: "tasks"; tasks: TaskItem[] }
  | { kind: "inbox"; items: InboxEntry[] }
  | { kind: "fleet"; job: FleetJobEvent }
  | { kind: "stats"; stats: AgentStats }
  | { kind: "compaction"; phase: "start" | "end" }
  | { kind: "subagent"; name: string; phase: "start" | "end" }
  | { kind: "transmission"; payload: string; severity: "low" | "medium" | "high" }
  | { kind: "extension"; ext: "hook" | "skill"; name: string }
  | { kind: "display_slot_pushed"; slot: DisplaySlotEvent }
  | { kind: "display_slot_resolved"; slotId: string }
  | { kind: "session_reset" }
  | { kind: "error"; message: string };

export const initialUiState: UiState = {
  turns: [],
  streamingText: "",
  busy: false,
  plan: null,
  tasks: [],
  inbox: [],
  fleetJobs: [],
  stats: { turns: 0, tokens_in: 0, tokens_out: 0, contextPct: 0 },
  compacting: false,
  activeSubagents: [],
  transmissions: [],
  displaySlots: [],
  mood: "idle",
};

export function reduceUiState(state: UiState, action: UiAction): UiState {
  let next = state;
  switch (action.kind) {
    case "session_hydrate":
      next = {
        ...state,
        turns: action.turns,
        plan: action.plan,
        tasks: action.tasks,
        inbox: action.inbox,
        stats: action.stats,
        streamingText: "",
        busy: false,
        compacting: false,
        activeSubagents: [],
        displaySlots: [],
      };
      break;
    case "turn":
      next = { ...state, turns: [...state.turns, action.turn] };
      break;
    case "turn_update":
      next = { ...state, turns: state.turns.map((t) => t.id === action.id ? { ...t, ...action.patch } : t) };
      break;
    case "text_delta":
      next = { ...state, streamingText: state.streamingText + action.text };
      break;
    case "text_clear":
      next = { ...state, streamingText: "" };
      break;
    case "tool_started":
      next = { ...state, turns: [...state.turns, toolTurn(action.tool)] };
      break;
    case "tool_finished":
      next = {
        ...state,
        turns: state.turns.map((t) =>
          t.kind === "tool" && t.tool?.id === action.tool.id ? { ...t, tool: action.tool } : t),
      };
      break;
    case "busy":
      next = { ...state, busy: action.busy, lastError: action.busy ? undefined : state.lastError };
      break;
    case "plan":
      next = { ...state, plan: action.plan };
      break;
    case "tasks":
      next = { ...state, tasks: action.tasks };
      break;
    case "inbox":
      next = { ...state, inbox: action.items };
      break;
    case "fleet":
      next = { ...state, fleetJobs: upsertFleetJob(state.fleetJobs, action.job) };
      break;
    case "stats":
      next = { ...state, stats: action.stats };
      break;
    case "compaction":
      next = { ...state, compacting: action.phase === "start" };
      break;
    case "subagent":
      next = { ...state, activeSubagents: updateSubagents(state.activeSubagents, action) };
      break;
    case "transmission":
      next = {
        ...state,
        transmissions: [
          ...state.transmissions,
          { payload: action.payload, severity: action.severity, at: Date.now() },
        ].slice(-40),
      };
      break;
    case "extension":
      next = { ...state, lastExtension: { kind: action.ext, name: action.name, at: Date.now() } };
      break;
    case "display_slot_pushed":
      next = { ...state, displaySlots: [...state.displaySlots, action.slot] };
      break;
    case "display_slot_resolved":
      next = { ...state, displaySlots: state.displaySlots.filter((r) => r.slotId !== action.slotId) };
      break;
    case "session_reset":
      next = { ...initialUiState, transmissions: state.transmissions };
      break;
    case "error":
      next = { ...state, lastError: action.message };
      break;
  }
  return { ...next, mood: moodFrom(next) };
}

function moodFrom(s: UiState): UiState["mood"] {
  if (s.lastError) return "error";
  if (s.activeSubagents.length > 0) return "working";
  if (s.fleetJobs.some((j) => j.status === "running")) return "working";
  if (s.busy && s.streamingText) return "speaking";
  if (s.busy) return "working";
  const recentHigh = s.transmissions.find((t) => t.severity === "high" && Date.now() - t.at < 2500);
  return recentHigh ? "glitched" : "idle";
}

function toolTurn(tool: ToolEvent): ChatTurn {
  return { id: `t_${tool.id}`, kind: "tool", tool, createdAt: Date.now() };
}

function upsertFleetJob(jobs: FleetJobEvent[], job: FleetJobEvent): FleetJobEvent[] {
  return [...jobs.filter((j) => j.runId !== job.runId), job].slice(-40);
}

function updateSubagents(
  active: string[],
  action: { name: string; phase: "start" | "end" },
): string[] {
  if (action.phase === "start") return [...active, action.name];
  const idx = active.lastIndexOf(action.name);
  return idx === -1 ? active : active.filter((_, i) => i !== idx);
}
