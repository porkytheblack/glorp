/**
 * Synchronous message endpoint for programmatic testing.
 *
 * Sends a message to the agent, collects all bridge events until the
 * agent finishes (busy: false after busy: true), and returns a
 * structured response. Optionally auto-approves permission prompts
 * so tool-heavy flows don't hang in headless testing.
 */

import type { GlorpHandle } from "../agent/glorp-types.ts";
import type { Bridge } from "../shared/bridge.ts";
import type { BridgeEvent, ChatTurn, ToolEvent } from "../shared/events.ts";
import type {
  SendMessageRequest,
  SendMessageResponse,
  SubagentEvent,
  OrchestratorAgentEvt,
} from "../protocol/rest.ts";

export async function handleSendMessage(
  handle: GlorpHandle,
  bridge: Bridge,
  body: SendMessageRequest,
): Promise<SendMessageResponse> {
  const timeout = body.timeout_ms ?? 120_000;
  const autoApprove = body.auto_approve ?? true;
  const cleanupAgents = body.cleanup_agents ?? true;
  const start = Date.now();

  const turns: ChatTurn[] = [];
  const tools: ToolEvent[] = [];
  const subagents: SubagentEvent[] = [];
  const orchestratorAgents: OrchestratorAgentEvt[] = [];
  let agentText: string | null = null;
  let error: string | null = null;
  let streamText = "";
  let seenBusy = false;

  return new Promise<SendMessageResponse>((resolve) => {
    const timer = setTimeout(() => finish("timeout"), timeout);

    const unsub = bridge.subscribe((event: BridgeEvent) => {
      switch (event.type) {
        case "turn":
          turns.push(event.turn);
          if (event.turn.kind === "agent" && event.turn.text) agentText = event.turn.text;
          break;
        case "text_delta":
          streamText += event.text;
          break;
        case "tool_started":
          tools.push(event.tool);
          break;
        case "tool_finished": {
          const idx = tools.findIndex((t) => t.id === event.tool.id);
          if (idx >= 0) tools[idx] = event.tool;
          else tools.push(event.tool);
          break;
        }
        case "subagent":
          subagents.push({ name: event.name, phase: event.phase, status: event.status, message: event.message });
          break;
        case "orchestrator_agent":
          orchestratorAgents.push(event.agent);
          break;
        case "error":
          error = event.message;
          break;
        case "display_slot_pushed":
          if (autoApprove && event.slot.isPermissionRequest) {
            // Defer to macrotask: pushAndWait registers the resolver in a
            // new Promise() AFTER await notify() returns and its microtask
            // queue drains, so both sync and queueMicrotask fire too early.
            setTimeout(() => handle.resolvePermission(event.slot.slotId, true), 0);
          }
          break;
        case "busy":
          if (event.busy) seenBusy = true;
          else if (seenBusy) finish();
          break;
      }
    });

    function finish(reason?: string) {
      clearTimeout(timer);
      unsub();
      if (reason === "timeout") error = error ?? "Request timed out";
      const response: SendMessageResponse = {
        text: agentText ?? (streamText || null),
        turns,
        tools,
        subagents,
        orchestrator_agents: orchestratorAgents,
        error,
        duration_ms: Date.now() - start,
      };
      // Stop lingering subprocess agents after the response is ready.
      if (cleanupAgents) {
        void cleanupRunningAgents(handle, orchestratorAgents).catch(() => {});
      }
      resolve(response);
    }

    void handle.send(body.text, body.images);
  });
}

/** Stop any agents that were spawned during this turn and are still running. */
async function cleanupRunningAgents(
  handle: GlorpHandle,
  agents: OrchestratorAgentEvt[],
): Promise<void> {
  const spawned = new Set<string>();
  const stopped = new Set<string>();
  for (const a of agents) {
    if (a.action === "spawned" && a.id) spawned.add(a.id);
    if (a.action === "stopped" && a.id) stopped.add(a.id);
  }
  for (const id of spawned) {
    if (!stopped.has(id)) {
      await handle.stopAgent(id, "conversation turn ended").catch(() => {});
    }
  }
}
