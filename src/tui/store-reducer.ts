import type {
  AgentStats, ChatTurn, DisplaySlotEvent, InboxEntry, OrchestratorAgentEvent,
  OrchestratorPhase, PlanDocument, RunnerAgentStats, TaskItem, ToolEvent,
} from "../shared/events.ts";

export interface UiState {
  turns: ChatTurn[];
  title: string | null;
  streamingText: string;
  busy: boolean;
  plan: PlanDocument | null;
  tasks: TaskItem[];
  inbox: InboxEntry[];
  orchestratorAgents: OrchestratorAgentEvent[];
  loopPhase: OrchestratorPhase | null;
  loopId: string | null;
  loopVerdicts: Array<{ checkpoint: string; action: string; detail?: string }>;
  foregroundAgent: string | null;
  planStatus: { path: string; title?: string; status: "created" | "accepted" } | null;
  stats: AgentStats;
  compacting: boolean;
  activeSubagents: string[];
  transmissions: Array<{ payload: string; severity: "low" | "medium" | "high"; at: number }>;
  lastExtension?: { kind: "hook" | "skill"; name: string; at: number };
  runnerStats: Record<string, RunnerAgentStats & { updatedAt: number }>;
  displaySlots: DisplaySlotEvent[];
  lastError?: string;
  mood: "idle" | "thinking" | "working" | "speaking" | "glitched" | "error";
  peerCount: number;
  modelLabel: string;
  permissionMode: "normal" | "auto" | "bypass";
}

export type UiAction =
  | { kind: "session_hydrate"; turns: ChatTurn[]; title: string | null; plan: PlanDocument | null; tasks: TaskItem[]; inbox: InboxEntry[]; stats: AgentStats }
  | { kind: "title"; title: string | null }
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
  | { kind: "orchestrator_agent"; agent: OrchestratorAgentEvent }
  | { kind: "orchestrator_phase"; loopId: string; phase: OrchestratorPhase }
  | { kind: "orchestrator_verdict"; loopId: string; checkpoint: string; verdictAction: string; detail?: string }
  | { kind: "orchestrator_plan_event"; planAction: "created" | "accepted"; path: string; title?: string }
  | { kind: "orchestrator_slot_switch"; promoted: string; demoted: string }
  | { kind: "stats"; stats: AgentStats }
  | { kind: "compaction"; phase: "start" | "end" }
  | { kind: "subagent"; name: string; phase: "start" | "end" }
  | { kind: "transmission"; payload: string; severity: "low" | "medium" | "high" }
  | { kind: "extension"; ext: "hook" | "skill"; name: string }
  | { kind: "runner_agent_stats"; agent: RunnerAgentStats }
  | { kind: "display_slot_pushed"; slot: DisplaySlotEvent }
  | { kind: "display_slot_resolved"; slotId: string }
  | { kind: "session_reset" }
  | { kind: "error"; message: string }
  | { kind: "peer_count"; count: number }
  | { kind: "model_label_changed"; label: string }
  | { kind: "permission_mode_changed"; mode: "normal" | "auto" | "bypass" };

export const initialUiState: UiState = {
  turns: [], title: null, streamingText: "", busy: false, plan: null, tasks: [],
  inbox: [], orchestratorAgents: [], loopPhase: null, loopId: null,
  loopVerdicts: [], foregroundAgent: null, planStatus: null,
  stats: { turns: 0, tokens_in: 0, tokens_out: 0, contextPct: 0 },
  compacting: false, activeSubagents: [], transmissions: [], runnerStats: {},
  displaySlots: [], mood: "idle", peerCount: 0, modelLabel: "", permissionMode: "normal",
};

export function reduceUiState(state: UiState, action: UiAction): UiState {
  let next = state;
  switch (action.kind) {
    case "session_hydrate":
      next = { ...state, turns: action.turns, title: action.title, plan: action.plan, tasks: action.tasks, inbox: action.inbox, stats: action.stats, streamingText: "", busy: false, compacting: false, activeSubagents: [], displaySlots: [] };
      break;
    case "turn":
      next = { ...state, turns: [...state.turns, action.turn] }; break;
    case "title":
      next = { ...state, title: action.title }; break;
    case "turn_update":
      next = { ...state, turns: state.turns.map((t) => t.id === action.id ? { ...t, ...action.patch } : t) }; break;
    case "text_delta":
      next = { ...state, streamingText: state.streamingText + action.text }; break;
    case "text_clear":
      next = { ...state, streamingText: "" }; break;
    case "tool_started":
      next = { ...state, turns: [...state.turns, { id: `t_${action.tool.id}`, kind: "tool", tool: action.tool, createdAt: Date.now() }] }; break;
    case "tool_finished":
      next = { ...state, turns: state.turns.map((t) => t.kind === "tool" && t.tool?.id === action.tool.id ? { ...t, tool: action.tool } : t) }; break;
    case "busy":
      next = { ...state, busy: action.busy, lastError: action.busy ? undefined : state.lastError }; break;
    case "plan":
      next = { ...state, plan: action.plan }; break;
    case "tasks":
      next = { ...state, tasks: action.tasks }; break;
    case "inbox":
      next = { ...state, inbox: action.items }; break;
    case "orchestrator_agent":
      next = { ...state, orchestratorAgents: upsertAgent(state.orchestratorAgents, action.agent) }; break;
    case "orchestrator_phase": {
      const verdicts = action.loopId !== state.loopId ? [] : state.loopVerdicts;
      const rs = action.phase === "completed" || action.phase === "terminated" ? {} : state.runnerStats;
      next = { ...state, loopPhase: action.phase, loopId: action.loopId, loopVerdicts: verdicts, runnerStats: rs }; break;
    }
    case "orchestrator_verdict": {
      const v = { checkpoint: action.checkpoint, action: action.verdictAction, detail: action.detail };
      const vt = orchTurn(`${action.checkpoint} ${action.verdictAction}${action.detail ? `: ${action.detail}` : ""}`, "verdict");
      next = { ...state, loopVerdicts: [...state.loopVerdicts, v], turns: [...state.turns, vt] }; break;
    }
    case "orchestrator_plan_event": {
      const ps = { path: action.path, title: action.title, status: action.planAction } as UiState["planStatus"];
      const pt = orchTurn(action.planAction === "created" ? `Plan created${action.title ? `: ${action.title}` : ""}` : "Plan accepted", "plan");
      next = { ...state, planStatus: ps, turns: [...state.turns, pt] }; break;
    }
    case "orchestrator_slot_switch":
      next = { ...state, foregroundAgent: action.promoted || null }; break;
    case "stats":
      next = { ...state, stats: action.stats }; break;
    case "compaction":
      next = { ...state, compacting: action.phase === "start" }; break;
    case "subagent":
      next = { ...state, activeSubagents: action.phase === "start" ? [...state.activeSubagents, action.name] : state.activeSubagents.filter((_, i, a) => i !== a.lastIndexOf(action.name)) }; break;
    case "transmission":
      next = { ...state, transmissions: [...state.transmissions, { payload: action.payload, severity: action.severity, at: Date.now() }].slice(-40) }; break;
    case "extension":
      next = { ...state, lastExtension: { kind: action.ext, name: action.name, at: Date.now() } }; break;
    case "runner_agent_stats":
      next = { ...state, runnerStats: { ...state.runnerStats, [action.agent.agentId]: { ...action.agent, updatedAt: Date.now() } } }; break;
    case "display_slot_pushed":
      next = { ...state, displaySlots: [...state.displaySlots, action.slot] }; break;
    case "display_slot_resolved":
      next = { ...state, displaySlots: state.displaySlots.filter((r) => r.slotId !== action.slotId) }; break;
    case "session_reset":
      next = { ...initialUiState, transmissions: state.transmissions, runnerStats: {}, peerCount: state.peerCount, modelLabel: state.modelLabel }; break;
    case "error":
      next = { ...state, lastError: action.message }; break;
    case "peer_count":
      next = { ...state, peerCount: action.count }; break;
    case "model_label_changed":
      next = { ...state, modelLabel: action.label }; break;
    case "permission_mode_changed":
      next = { ...state, permissionMode: action.mode }; break;
  }
  return { ...next, mood: moodFrom(next) };
}

let orchSeq = 0;
function orchTurn(text: string, sub: string): ChatTurn {
  return { id: `orch_${++orchSeq}`, kind: "system", text, meta: { orchestrator: true, subtype: sub }, createdAt: Date.now() };
}

function moodFrom(s: UiState): UiState["mood"] {
  if (s.lastError) return "error";
  if (s.loopPhase === "generating" || s.loopPhase === "evaluating") return "working";
  if (s.activeSubagents.length > 0) return "working";
  if (s.orchestratorAgents.some((a) => a.action === "spawned")) return "working";
  if (s.busy && s.streamingText) return "speaking";
  if (s.busy) return "working";
  const recentHigh = s.transmissions.find((t) => t.severity === "high" && Date.now() - t.at < 2500);
  return recentHigh ? "glitched" : "idle";
}

function upsertAgent(agents: OrchestratorAgentEvent[], agent: OrchestratorAgentEvent): OrchestratorAgentEvent[] {
  if (agent.action === "stopped") return agents.filter((a) => a.id !== agent.id);
  return [...agents.filter((a) => a.id !== agent.id), agent].slice(-40);
}
