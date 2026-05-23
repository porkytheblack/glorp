import { useEffect, useReducer, useRef } from "react";
import { getBridge } from "../shared/bridge.ts";
import { initialUiState, reduceUiState } from "./store-reducer.ts";
import type { UiState } from "./store-reducer.ts";

export type { UiState } from "./store-reducer.ts";

export function useUiState(): UiState {
  const [state, dispatch] = useReducer(reduceUiState, initialUiState);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const bridge = getBridge();
    const unsubscribe = bridge.subscribe((ev) => {
      switch (ev.type) {
        case "session_hydrate":
          dispatchRef.current({
            kind: "session_hydrate",
            turns: ev.turns,
            plan: ev.plan,
            tasks: ev.tasks,
            inbox: ev.inbox,
            stats: ev.stats,
          });
          break;
        case "turn":
          dispatchRef.current({ kind: "turn", turn: ev.turn });
          break;
        case "turn_update":
          dispatchRef.current({ kind: "turn_update", id: ev.id, patch: ev.patch });
          break;
        case "text_delta":
          dispatchRef.current({ kind: "text_delta", text: ev.text });
          break;
        case "text_clear":
          dispatchRef.current({ kind: "text_clear" });
          break;
        case "tool_started":
          dispatchRef.current({ kind: "tool_started", tool: ev.tool });
          break;
        case "tool_finished":
          dispatchRef.current({ kind: "tool_finished", tool: ev.tool });
          break;
        case "busy":
          dispatchRef.current({ kind: "busy", busy: ev.busy });
          break;
        case "plan":
          dispatchRef.current({ kind: "plan", plan: ev.plan });
          break;
        case "tasks":
          dispatchRef.current({ kind: "tasks", tasks: ev.tasks });
          break;
        case "inbox":
          dispatchRef.current({ kind: "inbox", items: ev.items });
          break;
        case "fleet":
          dispatchRef.current({ kind: "fleet", job: ev.job });
          break;
        case "stats":
          dispatchRef.current({ kind: "stats", stats: ev.stats });
          break;
        case "compaction":
          dispatchRef.current({ kind: "compaction", phase: ev.phase });
          break;
        case "subagent":
          dispatchRef.current({ kind: "subagent", name: ev.name, phase: ev.phase });
          break;
        case "transmission":
          dispatchRef.current({
            kind: "transmission",
            payload: ev.payload,
            severity: ev.severity,
          });
          break;
        case "hook":
          dispatchRef.current({ kind: "extension", ext: "hook", name: ev.name });
          break;
        case "skill":
          dispatchRef.current({ kind: "extension", ext: "skill", name: ev.name });
          break;
        case "display_slot_pushed":
          dispatchRef.current({ kind: "display_slot_pushed", slot: ev.slot });
          break;
        case "display_slot_resolved":
          dispatchRef.current({ kind: "display_slot_resolved", slotId: ev.slotId });
          break;
        case "session_reset":
          dispatchRef.current({ kind: "session_reset" });
          break;
        case "error":
          dispatchRef.current({ kind: "error", message: ev.message });
          break;
      }
    });
    // Wrap so the effect returns `() => void`, not `() => boolean`.
    return () => {
      unsubscribe();
    };
  }, []);
  return state;
}
