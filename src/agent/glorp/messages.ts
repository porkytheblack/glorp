import type { Message, ModelPromptResult } from "glove-core/core";
import type { ChatTurn } from "../../shared/events.ts";

export function visibleMessageText(message: Message): string {
  const text = message.pre_modified_text ?? message.text ?? "";
  if (text.trim()) return text;
  const parts = message.content ?? [];
  return parts
    .map((part) => (part.type === "text" ? part.text ?? "" : `[${part.type} attachment]`))
    .filter(Boolean)
    .join("\n");
}

export function isVisibleTranscriptMessage(message: Message): boolean {
  if (message.is_compaction || message.is_compaction_request || message.is_skill_injection) return false;
  if (message.tool_results?.length) return false;
  return visibleMessageText(message).trim().length > 0;
}

function hasVisibleAgentOutput(message: Message): boolean {
  if (message.sender !== "agent") return false;
  if ((message.tool_calls?.length ?? 0) > 0) return true;
  return visibleMessageText(message).trim().length > 0;
}

export function modelResultHasVisibleAgentOutput(result: ModelPromptResult | Message): boolean {
  const messages = "messages" in result ? result.messages : [result];
  return messages.some(hasVisibleAgentOutput);
}

export function modelResultHasToolCall(result: ModelPromptResult | Message): boolean {
  const messages = "messages" in result ? result.messages : [result];
  return messages.some((message) => (message.tool_calls?.length ?? 0) > 0);
}

const VERBS =
  "(?:start|begin|check|inspect|look|read|open|review|edit|update|patch|fix|run|test|verify|investigate|continue|proceed|work|implement|make|add|wire|trace|debug|rewrite|write|create|generate|build|validate|resolve)";
const GERUNDS =
  "(?:checking|inspecting|reading|opening|reviewing|editing|updating|patching|fixing|running|testing|verifying|investigating|continuing|proceeding|implementing|adding|wiring|tracing|debugging|rewriting|writing|creating|generating|building|validating|resolving)";

const INTENT_ONLY_PATTERNS: RegExp[] = [
  new RegExp(`\\bi'll\\s+${VERBS}\\b`),
  new RegExp(`\\bi will\\s+${VERBS}\\b`),
  new RegExp(`\\bi'm going to\\s+${VERBS}\\b`),
  new RegExp(`\\bi can\\s+${VERBS}\\b`),
  new RegExp(`\\blet me\\s+${VERBS}\\b`),
  new RegExp(`\\bnext,?\\s+i(?:'ll| will)\\s+${VERBS}\\b`),
  new RegExp(`\\bnow\\s+i(?:'ll| will)\\s+${VERBS}\\b`),
  new RegExp(`^${GERUNDS}\\b`),
  new RegExp(`\\b${GERUNDS}\\s+(?:now|next|the|this|with|using)\\b`),
];

function isIntentOnlyText(text: string): boolean {
  const normalized = text.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;
  return INTENT_ONLY_PATTERNS.some((p) => p.test(normalized));
}

export function modelResultIsIntentOnly(result: ModelPromptResult | Message): boolean {
  if (modelResultHasToolCall(result)) return false;
  const messages = "messages" in result ? result.messages : [result];
  const agentTexts = messages
    .filter((message) => message.sender === "agent")
    .map((message) => visibleMessageText(message).trim())
    .filter(Boolean);
  if (agentTexts.length === 0) return false;
  return agentTexts.every(isIntentOnlyText);
}

export function messageHasOpenTaskUpdate(
  message: Message | undefined,
  toolName: string = "glove_update_tasks",
): boolean {
  return (message?.tool_results ?? []).some((toolResult) => {
    if (toolResult.tool_name.toLowerCase() !== toolName) return false;
    if (toolResult.result.status !== "success") return false;
    return hasOpenTasks(toolResult.result.data);
  });
}

function hasOpenTasks(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const tasks = (data as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return false;
  return tasks.some((task) => task && typeof task === "object" && (task as { status?: unknown }).status !== "completed");
}

export function messagesToChatTurns(sessionId: string, messages: Message[]): ChatTurn[] {
  const visible = messages.filter(isVisibleTranscriptMessage);
  const now = Date.now();
  return visible.map((message, index) => ({
    id: message.id ?? `h_${sessionId}_${index}`,
    kind: message.sender === "user" ? "user" : "agent",
    text: visibleMessageText(message),
    createdAt: now - (visible.length - index),
  }));
}
