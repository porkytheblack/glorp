import { useReducer, useEffect, useRef } from "react";
import type { GlorpClient } from "../client/client.ts";
import { serverMessageToBridgeEvent } from "../client/bridge-adapter.ts";
import type { BridgeEvent } from "../shared/events.ts";
import { reduceUiState, initialUiState, type UiState, type UiAction } from "./store-reducer.ts";

export type { UiState } from "./store-reducer.ts";

function bridgeEventToAction(ev: BridgeEvent): UiAction | null {
  switch (ev.type) {
    case "session_hydrate":
      return { kind: "session_hydrate", turns: ev.turns, title: ev.title, plan: ev.plan, tasks: ev.tasks, inbox: ev.inbox, stats: ev.stats };
    case "title": return { kind: "title", title: ev.title };
    case "turn": return { kind: "turn", turn: ev.turn };
    case "turn_update": return { kind: "turn_update", id: ev.id, patch: ev.patch };
    case "text_delta": return { kind: "text_delta", text: ev.text };
    case "text_clear": return { kind: "text_clear" };
    case "tool_started": return { kind: "tool_started", tool: ev.tool };
    case "tool_finished": return { kind: "tool_finished", tool: ev.tool };
    case "busy": return { kind: "busy", busy: ev.busy };
    case "plan": return { kind: "plan", plan: ev.plan };
    case "tasks": return { kind: "tasks", tasks: ev.tasks };
    case "inbox": return { kind: "inbox", items: ev.items };
    case "orchestrator_agent": return { kind: "orchestrator_agent", agent: ev.agent };
    case "orchestrator_phase": return { kind: "orchestrator_phase", loopId: ev.loopId, phase: ev.phase };
    case "orchestrator_verdict":
      return { kind: "orchestrator_verdict", loopId: ev.loopId, checkpoint: ev.checkpoint, verdictAction: ev.action, detail: ev.detail };
    case "orchestrator_plan":
      return { kind: "orchestrator_plan_event", planAction: ev.action, path: ev.path, title: ev.title };
    case "orchestrator_slot":
      return { kind: "orchestrator_slot_switch", promoted: ev.promoted, demoted: ev.demoted };
    case "agent_roster":
      return { kind: "agent_roster", agents: ev.agents, activeId: ev.activeId };
    case "stats": return { kind: "stats", stats: ev.stats };
    case "compaction": return { kind: "compaction", phase: ev.phase };
    case "subagent": return { kind: "subagent", name: ev.name, phase: ev.phase };
    case "transmission": return { kind: "transmission", payload: ev.payload, severity: ev.severity };
    case "hook": return { kind: "extension", ext: "hook", name: ev.name };
    case "skill": return { kind: "extension", ext: "skill", name: ev.name };
    case "runner_agent_stats": return { kind: "runner_agent_stats", agent: ev.agent };
    case "display_slot_pushed": return { kind: "display_slot_pushed", slot: ev.slot };
    case "display_slot_resolved": return { kind: "display_slot_resolved", slotId: ev.slotId };
    case "permission_mode_changed": return { kind: "permission_mode_changed", mode: ev.mode as UiState["permissionMode"] };
    case "session_reset": return { kind: "session_reset" };
    case "error": return { kind: "error", message: ev.message };
  }
}

export function useUiState(client: GlorpClient): UiState {
  const [state, dispatch] = useReducer(reduceUiState, initialUiState);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    return client.subscribe((msg) => {
      const bridgeEvent = serverMessageToBridgeEvent(msg);
      if (bridgeEvent) {
        const action = bridgeEventToAction(bridgeEvent);
        if (action) dispatchRef.current(action);
      }
      if (msg.type === "peer_joined" || msg.type === "peer_left") {
        const peerMsg = msg as { peer_count: number };
        dispatchRef.current({ kind: "peer_count", count: peerMsg.peer_count });
      }
      if (msg.type === "model_label_changed") {
        const labelMsg = msg as { label: string };
        dispatchRef.current({ kind: "model_label_changed", label: labelMsg.label });
      }
      if (msg.type === "server_hello") {
        const hello = msg as { peer_count: number; workspace: string; model_label?: string; permission_mode?: string };
        dispatchRef.current({ kind: "peer_count", count: hello.peer_count });
        if (hello.model_label) dispatchRef.current({ kind: "model_label_changed", label: hello.model_label });
        if (hello.permission_mode) dispatchRef.current({ kind: "permission_mode_changed", mode: hello.permission_mode as UiState["permissionMode"] });
      }
    });
  }, [client]);

  return state;
}
