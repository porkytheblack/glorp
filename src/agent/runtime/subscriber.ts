import type { SubscriberAdapter, ToolResultData } from "glove-core/core";
import type { BridgeEvent } from "../../shared/events.ts";
import type { ToolEvent } from "../../shared/events.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
}

interface Refreshers {
  stats(): Promise<void>;
  plan(): Promise<void>;
  tasks(): Promise<void>;
  inbox(): Promise<void>;
}

export function createGlorpSubscriber(
  bridge: Bridge,
  refresh: Refreshers,
): SubscriberAdapter {
  const activeTools = new Map<string, ToolEvent>();
  let streamingTextBuffer = "";
  let unkIdCounter = 0;
  const synthesizeId = () => `_unk_${++unkIdCounter}`;

  const flushStreamingTurn = () => {
    if (!streamingTextBuffer) return;
    bridge.emit({ type: "text_clear" });
    bridge.emit({
      type: "turn",
      turn: {
        id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "agent",
        text: streamingTextBuffer,
        createdAt: Date.now(),
      },
    });
    streamingTextBuffer = "";
  };

  return {
    async record(event_type, data) {
      switch (event_type) {
        case "text_delta": {
          const { text } = data as { text: string };
          streamingTextBuffer += text;
          bridge.emit({ type: "text_delta", text });
          break;
        }
        case "model_response_complete": {
          const d = data as { text: string };
          if (streamingTextBuffer || d.text) {
            const finalText = d.text || streamingTextBuffer;
            bridge.emit({ type: "text_clear" });
            streamingTextBuffer = "";
            bridge.emit({
              type: "turn",
              turn: {
                id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "agent",
                text: finalText,
                createdAt: Date.now(),
              },
            });
          }
          void refresh.stats();
          break;
        }
        case "model_response": {
          const d = data as { text: string };
          if (!streamingTextBuffer && d.text) {
            bridge.emit({
              type: "turn",
              turn: {
                id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "agent",
                text: d.text,
                createdAt: Date.now(),
              },
            });
          }
          void refresh.stats();
          break;
        }
        case "tool_use": {
          const d = data as { id: string; name: string; input: unknown };
          flushStreamingTurn();
          const ev: ToolEvent = {
            id: d.id,
            name: d.name,
            input: d.input,
            status: "running",
            startedAt: Date.now(),
          };
          activeTools.set(d.id, ev);
          bridge.emit({ type: "tool_started", tool: ev });
          break;
        }
        case "tool_use_result": {
          const d = data as { tool_name: string; call_id?: string; result: ToolResultData };
          let id = d.call_id;
          if (!id) {
            for (const [k, v] of activeTools) if (v.name === d.tool_name) id = k;
            if (!id) id = synthesizeId();
          }
          const prior = activeTools.get(id);
          const ev: ToolEvent = {
            id,
            name: d.tool_name,
            input: prior?.input,
            status: d.result.status,
            output: resultText(d.result),
            renderData: d.result.renderData,
            startedAt: prior?.startedAt ?? Date.now(),
            endedAt: Date.now(),
          };
          activeTools.delete(id);
          bridge.emit({ type: "tool_finished", tool: ev });
          if (d.tool_name === "glorp_update_plan") void refresh.plan();
          void refresh.tasks();
          void refresh.inbox();
          break;
        }
        case "compaction_start":
          bridge.emit({ type: "compaction", phase: "start" });
          break;
        case "compaction_end":
          bridge.emit({ type: "compaction", phase: "end" });
          void refresh.stats();
          break;
        case "subagent_invoked": {
          const d = data as { name: string };
          bridge.emit({ type: "subagent", name: d.name, phase: "start" });
          break;
        }
        case "subagent_completed": {
          const d = data as { name: string; status: "success" | "error"; message?: string };
          bridge.emit({ type: "subagent", name: d.name, phase: "end", status: d.status, message: d.message });
          break;
        }
        case "hook_invoked": {
          const d = data as { name: string };
          bridge.emit({ type: "hook", name: d.name });
          break;
        }
        case "skill_invoked": {
          const d = data as { name: string; source: "user" | "agent" };
          bridge.emit({ type: "skill", name: d.name, source: d.source });
          break;
        }
        case "token_consumption":
          void refresh.stats();
          break;
      }
    },
  };
}

function resultText(result: ToolResultData): string | undefined {
  if (typeof result.data === "string") return result.data;
  if (result.data == null) return result.message;
  return JSON.stringify(result.data);
}
