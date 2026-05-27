/**
 * Client→Server command types for the WebSocket protocol.
 * Each maps directly to one method on GlorpHandle.
 * Commands are fire-and-forget — results arrive as server events.
 */

import type { Envelope } from "./envelope.ts";

/** Base64-encoded image attached to a user message. */
export interface ImageAttachment {
  data: string;
  media_type: string;
}

export interface ClientHello extends Envelope {
  type: "client_hello";
  protocol_version: number;
  /** Opaque string identifying this client instance. */
  client_id: string;
  /** Optional human-readable name (shown in logs and peer events). */
  client_name?: string;
}

/** Send a user message. Maps to GlorpHandle.send(). */
export interface CmdSendMessage extends Envelope {
  type: "send_message";
  text: string;
  images?: ImageAttachment[];
}

/** Trigger plan-and-build flow. Maps to GlorpHandle.planAndBuild(). */
export interface CmdPlanAndBuild extends Envelope {
  type: "plan_and_build";
  prompt: string;
}

/** Abort the current request. Maps to GlorpHandle.abort(). */
export interface CmdAbort extends Envelope {
  type: "abort";
}

/** Resolve a display slot. Maps to GlorpHandle.resolveSlot(). */
export interface CmdResolveSlot extends Envelope {
  type: "resolve_slot";
  slot_id: string;
  value: unknown;
}

/** Reject a display slot. Maps to GlorpHandle.rejectSlot(). */
export interface CmdRejectSlot extends Envelope {
  type: "reject_slot";
  slot_id: string;
  reason?: string;
}

/** Resolve a permission prompt. Maps to GlorpHandle.resolvePermission(). */
export interface CmdResolvePermission extends Envelope {
  type: "resolve_permission";
  slot_id: string;
  allow: boolean;
}

/** Swap model profile. Maps to GlorpHandle.swapProfile(). */
export interface CmdSwapProfile extends Envelope {
  type: "swap_profile";
  profile_id: string;
}

/** Clear all permission grants for a tool. */
export interface CmdClearPermission extends Envelope {
  type: "clear_permission";
  tool_name: string;
}

/** Clear a single canonical permission key. */
export interface CmdClearPermissionKey extends Envelope {
  type: "clear_permission_key";
  key: string;
}

/** Request full state re-sync. Server responds with session_hydrate. */
export interface CmdResync extends Envelope {
  type: "resync";
}

/** Stop a running orchestrated agent. Maps to GlorpHandle.stopAgent(). */
export interface CmdStopAgent extends Envelope {
  type: "stop_agent";
  agent_id: string;
  reason?: string;
}

/** Promote a background agent to foreground. Maps to GlorpHandle.promoteAgent(). */
export interface CmdPromoteAgent extends Envelope {
  type: "promote_agent";
  agent_id: string;
}

export type ClientMessage =
  | ClientHello
  | CmdSendMessage
  | CmdPlanAndBuild
  | CmdAbort
  | CmdResolveSlot
  | CmdRejectSlot
  | CmdResolvePermission
  | CmdSwapProfile
  | CmdClearPermission
  | CmdClearPermissionKey
  | CmdResync
  | CmdStopAgent
  | CmdPromoteAgent;
