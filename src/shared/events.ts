/**
 * Wire types between the in-process Glove agent and the OpenTUI frontend.
 * Both halves run on the same Bun thread; this module is the contract.
 */

export type ToolStatus = "running" | "success" | "error" | "aborted";

export interface ToolEvent {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  output?: string;
  renderData?: unknown;
  startedAt: number;
  endedAt?: number;
}

export interface ChatTurn {
  id: string;
  kind: "user" | "agent" | "tool" | "system" | "transmission";
  text?: string;
  reasoning?: string;
  tool?: ToolEvent;
  meta?: Record<string, unknown>;
  createdAt: number;
}

export interface TaskItem {
  id: string;
  content: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
}

export interface PlanDocument {
  title: string;
  body: string;
  revision: number;
  updatedAt: string;
}

export interface InboxEntry {
  id: string;
  tag: string;
  request: string;
  response: string | null;
  status: "pending" | "resolved" | "consumed";
  blocking: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export type OrchestratorPhase =
  | "idle"
  | "generating"
  | "evaluating"
  | "checkpoint"
  | "terminated"
  | "completed";

export interface OrchestratorAgentEvent {
  id: string;
  label: string;
  action: "spawned" | "stopped" | "interrupted";
  role?: string;
  slot?: string;
}

/**
 * A conversational agent the user can switch between within a session.
 * Each has its own persistent transcript (store) and persona. Exactly one
 * is `active` at a time — input routes to it and the transcript shows it.
 */
export interface AgentInfo {
  id: string;
  label: string;
  role: string;
  active: boolean;
  busy: boolean;
  createdAt: number;
  lastActiveAt: number;
  turnCount: number;
}

export interface AgentStats {
  turns: number;
  tokens_in: number;
  tokens_out: number;
  contextPct: number;
  /** Cumulative estimated USD cost from catalog list pricing. Optional so older
   *  producers/consumers stay valid; absent ⇒ treat as 0. */
  cost_usd?: number;
  /** False when any attributed model lacked a catalog price (cost is a floor). */
  cost_known?: boolean;
}

export interface RunnerAgentStats {
  agentId: string;
  label: string;
  role: string;
  phase: string;
  turns: number;
  tokensIn: number;
  tokensOut: number;
}

export interface DisplaySlotEvent {
  slotId: string;
  renderer: string;
  input: unknown;
  createdAt: number;
  isPermissionRequest: boolean;
}

export type BridgeEvent =
  | {
    type: "session_hydrate";
    turns: ChatTurn[];
    title: string | null;
    plan: PlanDocument | null;
    tasks: TaskItem[];
    inbox: InboxEntry[];
    stats: AgentStats;
  }
  | { type: "title"; title: string | null }
  | { type: "turn"; turn: ChatTurn }
  | { type: "turn_update"; id: string; patch: Partial<ChatTurn> }
  | { type: "text_delta"; text: string }
  | { type: "text_clear" }
  | { type: "tool_started"; tool: ToolEvent }
  | { type: "tool_finished"; tool: ToolEvent }
  | { type: "busy"; busy: boolean }
  | { type: "plan"; plan: PlanDocument | null }
  | { type: "tasks"; tasks: TaskItem[] }
  | { type: "inbox"; items: InboxEntry[] }
  | { type: "orchestrator_phase"; loopId: string; phase: OrchestratorPhase }
  | { type: "orchestrator_verdict"; loopId: string; checkpoint: string; action: string; detail?: string }
  | { type: "orchestrator_agent"; agent: OrchestratorAgentEvent }
  | { type: "orchestrator_plan"; action: "created" | "accepted"; path: string; title?: string }
  | { type: "orchestrator_slot"; promoted: string; demoted: string }
  | { type: "agent_roster"; agents: AgentInfo[]; activeId: string }
  | { type: "stats"; stats: AgentStats }
  | { type: "runner_agent_stats"; agent: RunnerAgentStats }
  | { type: "compaction"; phase: "start" | "end" }
  | { type: "subagent"; name: string; phase: "start" | "end"; status?: "success" | "error"; message?: string }
  | { type: "transmission"; payload: string; severity: "low" | "medium" | "high" }
  | {
      type: "error";
      message: string;
      detail?: string;
      /** Classification so UIs can render a human headline + recovery action
       * instead of a raw stack trace (see shared/error-classify.ts). */
      kind?: "config" | "auth" | "modality" | "rate_limit" | "quota" | "network" | "upstream" | "internal";
      hint?: string;
      retryAfterSec?: number;
    }
  /** The model call is in flight but silent (e.g. provider-side retry sleeps).
   * Emitted periodically while waiting so UIs can show honest progress. */
  | { type: "model_status"; state: "waiting" | "active"; elapsedSec?: number }
  /** Messages waiting behind the running turn (per-session FIFO). */
  | { type: "queue_depth"; depth: number }
  | { type: "hook"; name: string }
  | { type: "skill"; name: string; source: "user" | "agent" }
  | { type: "display_slot_pushed"; slot: DisplaySlotEvent }
  | { type: "display_slot_resolved"; slotId: string }
  | { type: "permission_mode_changed"; mode: string }
  | { type: "session_reset" };

/** @deprecated kept for back-compat — replaced by DisplaySlotEvent + isPermissionRequest. */
export interface PermissionRequest {
  slotId: string;
  toolName: string;
  toolInput: unknown;
  createdAt: number;
}

export type BridgeListener = (event: BridgeEvent) => void;
