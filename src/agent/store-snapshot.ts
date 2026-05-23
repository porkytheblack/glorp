import type { Message, Task, PermissionStatus, InboxItem } from "glove-core/core";
import type { PlanDocument } from "../shared/events.ts";

export interface SnapshotMeta {
  kind: "session" | "subagent" | "fleet";
  parentSessionId?: string;
  namespace?: string;
  triggerMessageId?: string;
  triggerMessageIndex?: number;
  triggerMessageText?: string;
  durable?: boolean;
  createdAt: string;
}

export interface Snapshot {
  metadata?: SnapshotMeta;
  messages: Message[];
  tokensIn: number;
  tokensOut: number;
  turnCount: number;
  plan?: PlanDocument | null;
  tasks: Task[];
  permissions: Record<string, PermissionStatus>;
  inboxItems: InboxItem[];
}

export interface StoreOptions {
  filePath?: string;
  metadata?: SnapshotMeta;
}

export function safeFilePart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

export function latestTriggerMessage(messages: Message[]): { id: string; index: number; text: string } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.sender === "user" && !m.tool_results && !m.is_compaction && !m.is_skill_injection) {
      return { id: m.id ?? `message_${i}`, index: i, text: m.text.slice(0, 500) };
    }
  }
  return { id: `message_${messages.length}`, index: -1, text: "" };
}
