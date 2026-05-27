/**
 * Dispatch parsed client commands to the appropriate GlorpHandle method.
 */

import type { ClientMessage } from "../protocol/commands.ts";
import type { GlorpHandle } from "../agent/glorp-types.ts";

export function dispatchCommand(msg: ClientMessage, handle: GlorpHandle): void {
  switch (msg.type) {
    case "send_message":
      void handle.send(msg.text, msg.images);
      break;
    case "plan_and_build":
      void handle.planAndBuild(msg.prompt);
      break;
    case "abort":
      handle.abort();
      break;
    case "resolve_slot":
      handle.resolveSlot(msg.slot_id, msg.value);
      break;
    case "reject_slot":
      handle.rejectSlot(msg.slot_id, msg.reason);
      break;
    case "resolve_permission":
      handle.resolvePermission(msg.slot_id, msg.allow);
      break;
    case "swap_profile":
      void handle.swapProfile(msg.profile_id);
      break;
    case "clear_permission":
      void handle.clearPermission(msg.tool_name);
      break;
    case "clear_permission_key":
      void handle.clearPermissionKey(msg.key);
      break;
    case "resync":
      void handle.hydrateUi();
      break;
    case "stop_agent":
      void handle.stopAgent(msg.agent_id, msg.reason);
      break;
    case "promote_agent":
      handle.promoteAgent(msg.agent_id);
      break;
  }
}
