/**
 * Adapter that converts ServerMessage events from the WebSocket into
 * BridgeEvent-compatible actions, allowing the existing UI store-reducer
 * to consume remote events without any changes.
 */

import type { ServerMessage } from "../protocol/events.ts";
import type { BridgeEvent } from "../shared/events.ts";

/** Set of ServerMessage types that map 1:1 to BridgeEvent variants. */
const BRIDGE_TYPES: ReadonlySet<string> = new Set([
  "session_hydrate",
  "session_reset",
  "text_delta",
  "text_clear",
  "turn",
  "turn_update",
  "tool_started",
  "tool_finished",
  "busy",
  "title",
  "stats",
  "compaction",
  "plan",
  "tasks",
  "inbox",
  "subagent",
  "skill",
  "hook",
  "display_slot_pushed",
  "display_slot_resolved",
  "orchestrator_phase",
  "orchestrator_verdict",
  "orchestrator_agent",
  "orchestrator_plan",
  "orchestrator_slot",
  "agent_roster",
  "runner_agent_stats",
  "transmission",
  "permission_mode_changed",
  "error",
]);

/**
 * Convert a ServerMessage from the WebSocket into a BridgeEvent.
 *
 * Server-only messages (server_hello, peer_joined, peer_left,
 * model_label_changed, command_rejected, protocol_error) return null
 * since they have no BridgeEvent equivalent.
 */
export function serverMessageToBridgeEvent(msg: ServerMessage): BridgeEvent | null {
  if (!BRIDGE_TYPES.has(msg.type)) return null;

  // Strip the envelope fields (seq, ts) that BridgeEvent doesn't carry.
  // Destructure them away and keep everything else.
  const { seq: _seq, ts: _ts, ...event } = msg as ServerMessage & { seq: number; ts: string };
  return event as unknown as BridgeEvent;
}
