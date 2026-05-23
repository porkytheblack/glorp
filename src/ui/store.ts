import { useEffect, useReducer, useRef } from "react";
import { getBridge } from "../shared/bridge.ts";
import type { BridgeEvent } from "../shared/events.ts";
import { reduce } from "./ui-reducer.ts";
import { INITIAL_UI_STATE, type Action, type UiState } from "./ui-state.ts";

export type { UiState };

function actionFor(ev: BridgeEvent): Action | null {
  switch (ev.type) {
    case "turn": return { kind: "turn", turn: ev.turn };
    case "hydrate": return { kind: "hydrate", turns: ev.state.turns, title: ev.state.title };
    case "title": return { kind: "title", title: ev.title };
    case "turn_update": return { kind: "turn_update", id: ev.id, patch: ev.patch };
    case "text_delta": return { kind: "text_delta", text: ev.text };
    case "text_clear": return { kind: "text_clear" };
    case "tool_started": return { kind: "tool_started", tool: ev.tool };
    case "tool_finished": return { kind: "tool_finished", tool: ev.tool };
    case "busy": return { kind: "busy", busy: ev.busy };
    case "tasks": return { kind: "tasks", tasks: ev.tasks };
    case "inbox": return { kind: "inbox", items: ev.items };
    case "stats": return { kind: "stats", stats: ev.stats };
    case "compaction": return { kind: "compaction", phase: ev.phase };
    case "subagent": return { kind: "subagent", name: ev.name, phase: ev.phase };
    case "transmission": return { kind: "transmission", payload: ev.payload, severity: ev.severity };
    case "hook": return { kind: "extension", ext: "hook", name: ev.name };
    case "skill": return { kind: "extension", ext: "skill", name: ev.name };
    case "display_slot_pushed": return { kind: "display_slot_pushed", slot: ev.slot };
    case "display_slot_resolved": return { kind: "display_slot_resolved", slotId: ev.slotId };
    case "fleet_job": return { kind: "fleet_job", job: ev.job };
    case "session_reset": return { kind: "session_reset" };
    case "error": return { kind: "error", message: ev.message };
    default: return null;
  }
}

export function useUiState(): UiState {
  const [state, dispatch] = useReducer(reduce, INITIAL_UI_STATE);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const unsubscribe = getBridge().subscribe((ev) => {
      const action = actionFor(ev);
      if (action) dispatchRef.current(action);
    });
    return () => { unsubscribe(); };
  }, []);
  return state;
}
