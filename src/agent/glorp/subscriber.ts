import type { SubscriberAdapter, ToolResultData } from "glove-core/core";
import type { Bridge } from "../../shared/bridge.ts";
import type { ToolEvent } from "../../shared/events.ts";

export interface SubscriberState {
  requestAborted: boolean;
  compactionInFlight: boolean;
  suppressCompactionResponse: boolean;
  streamingTextBuffer: string;
  activeTools: Map<string, ToolEvent>;
  emittedAgentTexts: Set<string>;
}

export interface SubscriberHooks {
  refreshStats(): Promise<void>;
  refreshTasks(): Promise<void>;
  refreshInbox(): Promise<void>;
}

export function createSubscriberState(): SubscriberState {
  return {
    requestAborted: false,
    compactionInFlight: false,
    suppressCompactionResponse: false,
    streamingTextBuffer: "",
    activeTools: new Map(),
    emittedAgentTexts: new Set(),
  };
}

const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

export function createSubscriber(
  state: SubscriberState,
  bridge: Bridge,
  hooks: SubscriberHooks,
): SubscriberAdapter {
  const emitAgentTurn = (text: string) => {
    const key = normalise(text);
    if (!key || state.emittedAgentTexts.has(key)) return;
    state.emittedAgentTexts.add(key);
    bridge.emit({
      type: "turn",
      turn: {
        id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "agent",
        text,
        createdAt: Date.now(),
      },
    });
  };

  return {
    async record(event_type, data) {
      switch (event_type) {
        case "text_delta": handleTextDelta(state, bridge, data as { text: string }); break;
        case "model_response_complete": handleResponseComplete(state, bridge, data as { text: string }, emitAgentTurn, hooks); break;
        case "model_response": handleResponse(state, data as { text: string }, emitAgentTurn, hooks); break;
        case "tool_use": handleToolUse(state, bridge, data as { id: string; name: string; input: unknown }, emitAgentTurn); break;
        case "tool_use_result": await handleToolResult(state, bridge, data as { tool_name: string; call_id?: string; result: ToolResultData }, hooks); break;
        case "compaction_start": handleCompactionStart(state, bridge); break;
        case "compaction_end": handleCompactionEnd(state, bridge, hooks); break;
        case "subagent_invoked": bridge.emit({ type: "subagent", name: (data as { name: string }).name, phase: "start" }); break;
        case "subagent_completed": {
          const d = data as { name: string; status: "success" | "error"; message?: string };
          bridge.emit({ type: "subagent", name: d.name, phase: "end", status: d.status, message: d.message });
          break;
        }
        case "hook_invoked": bridge.emit({ type: "hook", name: (data as { name: string }).name }); break;
        case "skill_invoked": {
          const d = data as { name: string; source: "user" | "agent" };
          bridge.emit({ type: "skill", name: d.name, source: d.source });
          break;
        }
        case "token_consumption": void hooks.refreshStats(); break;
      }
    },
  };
}

function handleTextDelta(s: SubscriberState, bridge: Bridge, d: { text: string }): void {
  if (s.requestAborted || s.compactionInFlight || s.suppressCompactionResponse) return;
  s.streamingTextBuffer += d.text;
  bridge.emit({ type: "text_delta", text: d.text });
}

function handleResponseComplete(
  s: SubscriberState,
  bridge: Bridge,
  d: { text: string },
  emit: (t: string) => void,
  hooks: SubscriberHooks,
): void {
  if (s.requestAborted) { s.streamingTextBuffer = ""; bridge.emit({ type: "text_clear" }); void hooks.refreshStats(); return; }
  if (s.compactionInFlight || s.suppressCompactionResponse) {
    s.streamingTextBuffer = ""; s.suppressCompactionResponse = false; bridge.emit({ type: "text_clear" }); void hooks.refreshStats(); return;
  }
  if (s.streamingTextBuffer || d.text) {
    const final = d.text || s.streamingTextBuffer;
    bridge.emit({ type: "text_clear" });
    s.streamingTextBuffer = "";
    emit(final);
  }
  void hooks.refreshStats();
}

function handleResponse(
  s: SubscriberState,
  d: { text: string },
  emit: (t: string) => void,
  hooks: SubscriberHooks,
): void {
  if (s.requestAborted) { void hooks.refreshStats(); return; }
  if (s.compactionInFlight || s.suppressCompactionResponse) { s.suppressCompactionResponse = false; void hooks.refreshStats(); return; }
  if (!s.streamingTextBuffer && d.text) emit(d.text);
  void hooks.refreshStats();
}

function handleToolUse(
  s: SubscriberState,
  bridge: Bridge,
  d: { id: string; name: string; input: unknown },
  emit: (t: string) => void,
): void {
  if (s.requestAborted) return;
  if (s.streamingTextBuffer) {
    bridge.emit({ type: "text_clear" });
    emit(s.streamingTextBuffer);
    s.streamingTextBuffer = "";
  }
  const ev: ToolEvent = { id: d.id, name: d.name, input: d.input, status: "running", startedAt: Date.now() };
  s.activeTools.set(d.id, ev);
  bridge.emit({ type: "tool_started", tool: ev });
}

let unkCounter = 0;
const synthesizeId = () => `_unk_${++unkCounter}`;

async function handleToolResult(
  s: SubscriberState,
  bridge: Bridge,
  d: { tool_name: string; call_id?: string; result: ToolResultData },
  hooks: SubscriberHooks,
): Promise<void> {
  if (s.requestAborted) return;
  let id = d.call_id;
  if (!id) {
    for (const [k, v] of s.activeTools) if (v.name === d.tool_name) id = k;
    if (!id) id = synthesizeId();
  }
  const prior = s.activeTools.get(id);
  const ev: ToolEvent = {
    id,
    name: d.tool_name,
    input: prior?.input,
    status: d.result.status,
    output: typeof d.result.data === "string"
      ? d.result.data
      : d.result.data == null ? d.result.message : JSON.stringify(d.result.data),
    renderData: d.result.renderData,
    startedAt: prior?.startedAt ?? Date.now(),
    endedAt: Date.now(),
  };
  s.activeTools.delete(id);
  bridge.emit({ type: "tool_finished", tool: ev });
  void hooks.refreshTasks();
  void hooks.refreshInbox();
}

function handleCompactionStart(s: SubscriberState, bridge: Bridge): void {
  s.compactionInFlight = true;
  s.suppressCompactionResponse = true;
  s.streamingTextBuffer = "";
  bridge.emit({ type: "text_clear" });
  bridge.emit({ type: "compaction", phase: "start" });
}

function handleCompactionEnd(s: SubscriberState, bridge: Bridge, hooks: SubscriberHooks): void {
  s.compactionInFlight = false;
  bridge.emit({ type: "compaction", phase: "end" });
  setTimeout(() => { if (!s.compactionInFlight) s.suppressCompactionResponse = false; }, 1000);
  void hooks.refreshStats();
}
