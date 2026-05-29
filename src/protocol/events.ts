/**
 * Server→Client event types for the WebSocket protocol.
 *
 * Every BridgeEvent variant maps 1:1 to a server event — plus lifecycle
 * events for connection management and multi-client awareness.
 * Re-exports shared data types from events.ts so clients only import
 * from the protocol package.
 */

import type { Envelope } from "./envelope.ts";
import type {
  AgentInfo,
  AgentStats,
  ChatTurn,
  DisplaySlotEvent,
  InboxEntry,
  OrchestratorAgentEvent,
  OrchestratorPhase,
  PlanDocument,
  RunnerAgentStats,
  TaskItem,
  ToolEvent,
} from "../shared/events.ts";

// Re-export the data types clients need.
export type {
  AgentInfo,
  AgentStats,
  ChatTurn,
  DisplaySlotEvent,
  InboxEntry,
  OrchestratorAgentEvent,
  OrchestratorPhase,
  PlanDocument,
  RunnerAgentStats,
  TaskItem,
  ToolEvent,
  ToolStatus,
} from "../shared/events.ts";

// ── Connection lifecycle ──────────────────────────────────────────

export interface ServerHello extends Envelope {
  type: "server_hello";
  protocol_version: number;
  server_version: string;
  session_id: string;
  workspace: string;
  peer_count: number;
  model_label?: string;
}

export interface PeerJoined extends Envelope {
  type: "peer_joined";
  client_id: string;
  peer_count: number;
}

export interface PeerLeft extends Envelope {
  type: "peer_left";
  client_id: string;
  peer_count: number;
}

// ── Bridge event relays ───────────────────────────────────────────

export interface WsSessionHydrate extends Envelope {
  type: "session_hydrate";
  turns: ChatTurn[];
  title: string | null;
  plan: PlanDocument | null;
  tasks: TaskItem[];
  inbox: InboxEntry[];
  stats: AgentStats;
}

export interface WsSessionReset extends Envelope { type: "session_reset" }
export interface WsTextDelta extends Envelope { type: "text_delta"; text: string }
export interface WsTextClear extends Envelope { type: "text_clear" }
export interface WsTurn extends Envelope { type: "turn"; turn: ChatTurn }
export interface WsTurnUpdate extends Envelope { type: "turn_update"; id: string; patch: Partial<ChatTurn> }
export interface WsToolStarted extends Envelope { type: "tool_started"; tool: ToolEvent }
export interface WsToolFinished extends Envelope { type: "tool_finished"; tool: ToolEvent }
export interface WsBusy extends Envelope { type: "busy"; busy: boolean }
export interface WsTitle extends Envelope { type: "title"; title: string | null }
export interface WsStats extends Envelope { type: "stats"; stats: AgentStats }
export interface WsCompaction extends Envelope { type: "compaction"; phase: "start" | "end" }
export interface WsPlan extends Envelope { type: "plan"; plan: PlanDocument | null }
export interface WsTasks extends Envelope { type: "tasks"; tasks: TaskItem[] }
export interface WsInbox extends Envelope { type: "inbox"; items: InboxEntry[] }
export interface WsSubagent extends Envelope {
  type: "subagent"; name: string; phase: "start" | "end"; status?: "success" | "error"; message?: string;
}
export interface WsSkill extends Envelope { type: "skill"; name: string; source: "user" | "agent" }
export interface WsHook extends Envelope { type: "hook"; name: string }
export interface WsDisplaySlotPushed extends Envelope { type: "display_slot_pushed"; slot: DisplaySlotEvent }
export interface WsDisplaySlotResolved extends Envelope { type: "display_slot_resolved"; slotId: string }
export interface WsOrchestratorPhase extends Envelope {
  type: "orchestrator_phase"; loopId: string; phase: OrchestratorPhase;
}
export interface WsOrchestratorVerdict extends Envelope {
  type: "orchestrator_verdict"; loopId: string; checkpoint: string; action: string; detail?: string;
}
export interface WsOrchestratorAgent extends Envelope { type: "orchestrator_agent"; agent: OrchestratorAgentEvent }
export interface WsOrchestratorPlan extends Envelope {
  type: "orchestrator_plan"; action: "created" | "accepted"; path: string; title?: string;
}
export interface WsOrchestratorSlot extends Envelope { type: "orchestrator_slot"; promoted: string; demoted: string }
export interface WsAgentRoster extends Envelope { type: "agent_roster"; agents: AgentInfo[]; activeId: string }
export interface WsRunnerAgentStats extends Envelope { type: "runner_agent_stats"; agent: RunnerAgentStats }
export interface WsTransmission extends Envelope { type: "transmission"; payload: string; severity: "low" | "medium" | "high" }
export interface WsError extends Envelope { type: "error"; message: string; detail?: string }

// ── Server-only events ────────────────────────────────────────────

export interface WsModelLabelChanged extends Envelope {
  type: "model_label_changed"; label: string; profile_id: string;
}
export interface WsCommandRejected extends Envelope {
  type: "command_rejected"; ref_seq: number; reason: string;
}
export interface WsProtocolError extends Envelope {
  type: "protocol_error"; message: string; caused_by_seq?: number;
}

// ── Union ─────────────────────────────────────────────────────────

export type ServerMessage =
  | ServerHello | PeerJoined | PeerLeft
  | WsSessionHydrate | WsSessionReset
  | WsTextDelta | WsTextClear | WsTurn | WsTurnUpdate
  | WsToolStarted | WsToolFinished | WsBusy | WsTitle | WsStats | WsCompaction
  | WsPlan | WsTasks | WsInbox
  | WsSubagent | WsSkill | WsHook
  | WsDisplaySlotPushed | WsDisplaySlotResolved
  | WsOrchestratorPhase | WsOrchestratorVerdict | WsOrchestratorAgent
  | WsOrchestratorPlan | WsOrchestratorSlot | WsAgentRoster | WsRunnerAgentStats
  | WsTransmission | WsError
  | WsModelLabelChanged | WsCommandRejected | WsProtocolError;
