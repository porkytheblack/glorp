import type { IGloveRunnable } from "glove-core/glove";
import type { GlorpStore } from "../store.ts";
import type { CredentialsStore } from "../credentials.ts";
import type { GlorpFleet } from "../fleet/types.ts";

export interface ExtensionCatalogue {
  slash: Array<{ name: string; description: string }>;
  skills: Array<{ name: string; description: string }>;
  mentions: Array<{ name: string; description: string }>;
}

export interface GlorpHandle {
  agent: IGloveRunnable;
  fleet: GlorpFleet;
  store: GlorpStore;
  credentials: CredentialsStore;
  sessionId: string;
  modelLabel: string;
  title: string | null;
  extensions: ExtensionCatalogue;
  hydrateUi(): Promise<void>;
  send(text: string): Promise<void>;
  abort(): void;
  shutdown(): Promise<void>;
  swapProfile(profileId: string): Promise<void>;
  resolveSlot(slotId: string, value: unknown): void;
  rejectSlot(slotId: string, reason?: string): void;
  resolvePermission(slotId: string, allow: boolean): void;
  clearPermission(toolName: string): Promise<void>;
  onLabelChange(fn: (label: string) => void): () => void;
}

export interface BuildGlorpOptions {
  workspace: string;
  sessionId: string;
  dataDir?: string;
  provider?: string;
  model?: string;
  credentials?: CredentialsStore;
}

export const CONTEXT_LIMIT = 180_000;
export const TASK_UPDATE_TOOL_NAME = "glove_update_tasks";
export const TASK_UPDATE_NOTE =
  "Task list updated. Task updates are bookkeeping only: if any task is still pending or in_progress, " +
  "continue immediately with the next concrete tool call.";
export const TASK_UPDATE_PROMPT =
  "[internal continuation] You just updated the task list and at least one task is still pending or in_progress. " +
  "Continue now with the next concrete tool call or, if genuinely blocked, state the blocker.";
export const EMPTY_RESPONSE_RETRY_PROMPT =
  "[internal retry] Your previous completion produced no visible answer or tool call. " +
  "Answer the user's latest request now. Keep any reasoning internal and produce visible text or a tool call.";
export const INTENT_ONLY_CONTINUATION_PROMPT =
  "[internal continuation] Your previous completion only stated an intention to continue, but made no tool call. " +
  "Continue now with the concrete next tool call. If you said a pending blocking inbox item is irrelevant, " +
  "call glove_update_inbox first. If genuinely blocked, state the blocker clearly.";
