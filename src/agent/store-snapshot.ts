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
  /**
   * Absolute filesystem path of the workspace this session belongs to.
   * Captured at session start; used by `listSessions` to scope the picker
   * to "this folder only" by default. Legacy snapshots without this field
   * are treated as unscoped.
   */
  workspace?: string;
  /**
   * Stable identifier for the project this workspace belongs to. Derived
   * from the git root-commit hash when available so worktrees / clones of
   * the same repo share sessions; falls back to a hash of `workspace` for
   * non-git directories. Persisted so the picker can group sessions by
   * project even when individual workspace paths differ.
   */
  projectId?: string;
}

export interface OriginalRequest {
  id: string;
  text: string;
  capturedAt: string;
}

export interface Snapshot {
  /** Schema version, owned by the migration engine (absent ⇒ pre-versioning). */
  version?: number;
  metadata?: SnapshotMeta;
  messages: Message[];
  title?: string | null;
  titleUpdatedAt?: string | null;
  tokensIn: number;
  tokensOut: number;
  turnCount: number;
  plan?: PlanDocument | null;
  tasks: Task[];
  permissions: Record<string, PermissionStatus>;
  inboxItems: InboxItem[];
  originalRequest?: OriginalRequest | null;
}

export interface StoreOptions {
  filePath?: string;
  metadata?: SnapshotMeta;
  /**
   * Workspace directory associated with this session. When metadata is
   * already supplied, prefer that; otherwise the store stamps the default
   * metadata with this workspace + a derived projectId so the picker can
   * scope sessions correctly.
   */
  workspace?: string;
  /** Pre-computed project id; usually derived from `workspace` via `deriveProjectId`. */
  projectId?: string;
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

/** Find the first real user message in a transcript. Skips skill injections,
 *  tool results, and compaction summaries — those are not the user's words. */
export function firstUserRequest(messages: Message[]): { id: string; index: number; text: string } | null {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m?.sender === "user" && !m.tool_results && !m.is_compaction && !m.is_skill_injection) {
      return { id: m.id ?? `message_${i}`, index: i, text: m.text };
    }
  }
  return null;
}
