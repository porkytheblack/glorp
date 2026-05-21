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

/**
 * A slot pushed onto the agent's display stack. Any custom modal the
 * agent wants to render — confirmation, info card, picker, form — flows
 * through this single mechanism. The UI looks up a renderer by `renderer`
 * name and either renders the matching component or shows a generic
 * fallback. Resolve/reject the slot via GlorpHandle.resolveSlot /
 * GlorpHandle.rejectSlot to unblock the agent (for pushAndWait slots).
 */
export interface DisplaySlotEvent {
  slotId: string;
  renderer: string;
  input: unknown;
  createdAt: number;
  /**
   * True if the renderer is `"permission_request"` — Glove's executor
   * pushes this kind of slot whenever a tool with `requiresPermission`
   * needs consent. Set by the bridge for convenience.
   */
  isPermissionRequest: boolean;
}

export type BridgeEvent =
  | { type: "turn"; turn: ChatTurn }
  | { type: "turn_update"; id: string; patch: Partial<ChatTurn> }
  | { type: "text_delta"; text: string }
  | { type: "text_clear" }
  | { type: "tool_started"; tool: ToolEvent }
  | { type: "tool_finished"; tool: ToolEvent }
  | { type: "busy"; busy: boolean }
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
  | { type: "session_reset" };

/** @deprecated kept for back-compat — replaced by DisplaySlotEvent + isPermissionRequest. */
export interface PermissionRequest {
  slotId: string;
  toolName: string;
  toolInput: unknown;
  createdAt: number;
}

export type BridgeListener = (event: BridgeEvent) => void;
