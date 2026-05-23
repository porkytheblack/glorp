import type {
  AgentStats,
  ChatTurn,
  DisplaySlotEvent,
  FleetJobUiEvent,
  InboxEntry,
  TaskItem,
  ToolEvent,
} from "../shared/events.ts";

export interface UiState {
  turns: ChatTurn[];
  title: string | null;
  streamingText: string;
  busy: boolean;
  tasks: TaskItem[];
  inbox: InboxEntry[];
  stats: AgentStats;
  compacting: boolean;
  activeSubagents: string[];
  transmissions: Array<{ payload: string; severity: "low" | "medium" | "high"; at: number }>;
  lastExtension?: { kind: "hook" | "skill"; name: string; at: number };
  displaySlots: DisplaySlotEvent[];
  fleetJobs: FleetJobUiEvent[];
  lastError?: string;
  mood: "idle" | "thinking" | "working" | "speaking" | "glitched" | "error";
}

export type Action =
  | { kind: "hydrate"; turns: ChatTurn[]; title: string | null }
  | { kind: "turn"; turn: ChatTurn }
  | { kind: "title"; title: string | null }
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
  | { kind: "fleet_job"; job: FleetJobUiEvent }
  | { kind: "session_reset" }
  | { kind: "error"; message: string };

export const INITIAL_UI_STATE: UiState = {
  turns: [],
  title: null,
  streamingText: "",
  busy: false,
  tasks: [],
  inbox: [],
  stats: { turns: 0, tokens_in: 0, tokens_out: 0, contextPct: 0 },
  compacting: false,
  activeSubagents: [],
  transmissions: [],
  displaySlots: [],
  fleetJobs: [],
  mood: "idle",
};

export function moodFrom(s: UiState): UiState["mood"] {
  if (s.lastError) return "error";
  if (s.compacting) return "thinking";
  if (s.activeSubagents.length > 0) return "working";
  if (s.busy && s.streamingText) return "speaking";
  if (s.busy) return "working";
  const recentHigh = s.transmissions.find((t) => t.severity === "high" && Date.now() - t.at < 2500);
  if (recentHigh) return "glitched";
  return "idle";
}
