import type { Message, ToolResultData } from "glove-core/core";
import type { BridgeEvent, ChatTurn, ToolEvent } from "../../shared/events.ts";
import type { GlorpStore } from "../store.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
}

export async function hydrateUiSession(
  store: GlorpStore,
  bridge: Bridge,
  contextLimit: number,
): Promise<void> {
  const [messages, title, plan, tasks, inboxItems, counts, turns] = await Promise.all([
    store.getDisplayMessages(),
    store.getTitle(),
    store.getPlan(),
    store.getTasks(),
    store.getInboxItems(),
    store.getTokenCounts(),
    store.getTurnCount(),
  ]);
  const total = counts.in + counts.out;
  bridge.emit({
    type: "session_hydrate",
    turns: turnsFromMessages(messages),
    title,
    plan,
    tasks: tasks.map((t) => ({
      id: t.id,
      content: t.content,
      activeForm: t.activeForm,
      status: t.status,
    })),
    inbox: inboxItems.map((i) => ({
      id: i.id,
      tag: i.tag,
      request: i.request,
      response: i.response,
      status: i.status,
      blocking: i.blocking,
      createdAt: i.created_at,
      resolvedAt: i.resolved_at,
    })),
    stats: {
      turns,
      tokens_in: counts.in,
      tokens_out: counts.out,
      contextPct: Math.min(100, Math.round((total / contextLimit) * 100)),
    },
  });
}

export function turnsFromMessages(messages: Message[]): ChatTurn[] {
  const base = Date.now() - messages.length * 1000;
  const turns: ChatTurn[] = [];
  const tools = new Map<string, ToolEvent>();
  messages.forEach((message, index) => {
    const createdAt = base + index * 1000;
    for (const result of message.tool_results ?? []) {
      const tool = resultEvent(result.tool_name, result.call_id, result.result, tools, createdAt);
      if (!tools.has(tool.id)) turns.push({ id: `t_${tool.id}`, kind: "tool", tool, createdAt });
      tools.set(tool.id, tool);
    }
    if (skipMessage(message)) return;
    if (message.text.trim()) turns.push(messageTurn(message, index, createdAt));
    for (const call of message.tool_calls ?? []) {
      const id = call.id ?? `hydrated_${index}_${tools.size}`;
      const tool: ToolEvent = {
        id,
        name: call.tool_name,
        input: call.input_args,
        status: "running",
        startedAt: createdAt,
      };
      tools.set(id, tool);
      turns.push({ id: `t_${id}`, kind: "tool", tool, createdAt });
    }
  });
  return turns.map((turn) =>
    turn.kind === "tool" && turn.tool ? { ...turn, tool: tools.get(turn.tool.id) ?? turn.tool } : turn
  );
}

function resultEvent(
  name: string,
  callId: string | undefined,
  result: ToolResultData,
  tools: Map<string, ToolEvent>,
  at: number,
): ToolEvent {
  const id = callId ?? `hydrated_result_${tools.size}`;
  const prior = tools.get(id);
  return {
    id,
    name,
    input: prior?.input,
    status: result.status,
    output: resultText(result),
    renderData: result.renderData,
    startedAt: prior?.startedAt ?? at,
    endedAt: at,
  };
}

function messageTurn(message: Message, index: number, createdAt: number): ChatTurn {
  return {
    id: message.id ?? `m_hydrated_${index}`,
    kind: message.sender === "user" ? "user" : "agent",
    text: message.text,
    createdAt,
  };
}

function skipMessage(message: Message): boolean {
  if (message.is_compaction || message.is_compaction_request || message.is_skill_injection) return true;
  if (message.tool_results?.length) return true;
  return message.text.startsWith("[internal task continuation]") || message.text.startsWith("[Inbox:");
}

function resultText(result: ToolResultData): string | undefined {
  if (typeof result.data === "string") return result.data;
  if (result.data == null) return result.message;
  return JSON.stringify(result.data);
}
