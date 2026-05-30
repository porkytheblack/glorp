/**
 * Wire contract mirrored from the Station backend:
 *   - BridgeEvent union   ← src/shared/events.ts
 *   - EventEnvelope        ← src/station/types.ts
 *   - SessionDto           ← src/station/types.ts
 *
 * Kept as a standalone copy (not imported from ../../src) so the browser
 * bundle never pulls in Bun/Node server code. If the backend events change,
 * update this file to match.
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

export interface AgentStats {
  turns: number;
  tokens_in: number;
  tokens_out: number;
  contextPct: number;
}

export interface DisplaySlotEvent {
  slotId: string;
  renderer: string;
  input: unknown;
  createdAt: number;
  isPermissionRequest: boolean;
}

export type BridgeEvent =
  | { type: "session_hydrate"; turns: ChatTurn[]; title: string | null; plan: PlanDocument | null; tasks: TaskItem[]; inbox: InboxEntry[]; stats: AgentStats }
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
  | { type: "stats"; stats: AgentStats }
  | { type: "compaction"; phase: "start" | "end" }
  | { type: "subagent"; name: string; phase: "start" | "end"; status?: "success" | "error"; message?: string }
  | { type: "transmission"; payload: string; severity: "low" | "medium" | "high" }
  | { type: "error"; message: string }
  | { type: "hook"; name: string }
  | { type: "skill"; name: string; source: "user" | "agent" }
  | { type: "display_slot_pushed"; slot: DisplaySlotEvent }
  | { type: "display_slot_resolved"; slotId: string }
  | { type: "permission_mode_changed"; mode: string }
  | { type: "session_reset" }
  // Orchestrator events — surfaced minimally in v1; carried through for the UI team.
  | { type: "orchestrator_phase"; loopId: string; phase: string }
  | { type: "orchestrator_agent"; agent: { id: string; label: string; action: string; role?: string; slot?: string } };

/** Per-message envelope sent over the session WebSocket. */
export interface EventEnvelope {
  sessionId: string;
  seq: number;
  event: BridgeEvent;
}

export type SessionLifecycle = "provisioning" | "idle" | "busy" | "error" | "destroyed";

export interface SessionDto {
  id: string;
  state: SessionLifecycle;
  workspace: string;
  title: string | null;
  model_label: string | null;
  permission_mode: string;
  created_at: string;
  last_activity: string;
  connected_clients: number;
  busy: boolean;
  loaded: boolean;
  tokens_in: number;
  tokens_out: number;
  turn_count: number;
  error: string | null;
  custom_credentials: { provider: string; last4: string } | null;
  ws_url?: string;
}
