import type { InboxItem, Message, Task } from "glove-core/core";
import type { PlanDocument } from "../shared/events.ts";

export interface SessionState {
  plan: PlanDocument | null;
  tasks: Task[];
  inboxItems: InboxItem[];
}

export function withSessionState(messages: Message[], state: SessionState): Message[] {
  const stateMessage = buildSessionStateMessage(state);
  if (!stateMessage) return [...messages];
  const index = latestUserMessageIndex(messages);
  if (index === -1) return [stateMessage, ...messages];
  return [...messages.slice(0, index), stateMessage, ...messages.slice(index)];
}

function buildSessionStateMessage(state: SessionState): Message | null {
  const openInbox = state.inboxItems.filter((item) => item.status === "pending");
  if (!state.plan && state.tasks.length === 0 && openInbox.length === 0) return null;
  return {
    sender: "user",
    is_skill_injection: true,
    text: [
      "[Current Glorp session state - not a user request]",
      renderPlan(state.plan),
      renderTasks(state.tasks),
      renderInbox(openInbox),
      "Task rule: before claiming the requested work is complete, call glove_update_tasks with the full corrected task list and no applicable task left pending or in_progress.",
      "Resource rule: for glove_resources_write, use body objects like {\"type\":\"markdown\",\"text\":\"...\"}; for edits use exact oldStr/newStr on an existing resource path.",
      "[End current Glorp session state]",
    ].filter(Boolean).join("\n"),
  };
}

function renderPlan(plan: PlanDocument | null): string {
  if (!plan) return "";
  const first = plan.body.split("\n").map((line) => line.trim()).find(Boolean);
  return [
    `Plan r${plan.revision}: ${plan.title}`,
    first ? `Plan note: ${clip(first, 220)}` : "",
  ].filter(Boolean).join("\n");
}

function renderTasks(tasks: Task[]): string {
  if (tasks.length === 0) return "";
  const lines = tasks.map((task) => {
    const active = task.status === "in_progress" ? `; active: ${task.activeForm}` : "";
    return `- [${task.status}] ${clip(task.content, 180)}${active}`;
  });
  return ["Tasks (authoritative execution checklist):", ...lines].join("\n");
}

function renderInbox(items: InboxItem[]): string {
  if (items.length === 0) return "";
  const lines = items.slice(0, 8).map((item) =>
    `- ${item.blocking ? "[blocking] " : ""}${item.tag}: ${clip(item.request, 180)}`
  );
  return ["Pending inbox:", ...lines].join("\n");
}

function latestUserMessageIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.sender === "user" && !m.tool_results && !m.is_skill_injection && !m.is_compaction) return i;
  }
  return -1;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "...";
}
