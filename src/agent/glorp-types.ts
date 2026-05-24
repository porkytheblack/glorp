import type { IGloveRunnable } from "glove-core/glove";
import type { PermissionStatus } from "glove-core/core";
import type { GlorpFleet } from "./station-bridge.ts";
import type { GlorpStore } from "./store.ts";
import type { CredentialsStore } from "./credentials.ts";

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
  send(text: string): Promise<void>;
  abort(): void;
  shutdown(): Promise<void>;
  swapProfile(profileId: string): Promise<void>;
  resolveSlot(slotId: string, value: unknown): void;
  rejectSlot(slotId: string, reason?: string): void;
  resolvePermission(slotId: string, allow: boolean): void;
  /** Sweep every persisted grant for a tool name (legacy "always allow X" UX). */
  clearPermission(toolName: string): Promise<void>;
  /** Surgically clear a single canonical permission key (e.g. `bash:git`). */
  clearPermissionKey(key: string): Promise<void>;
  /** Live snapshot of persisted permission grants for the Ctrl+P overlay. */
  listPermissions(): Array<{ key: string; status: PermissionStatus }>;
  onLabelChange(fn: (label: string) => void): () => void;
  hydrateUi(): Promise<void>;
}

export interface BuildGlorpOptions {
  workspace: string;
  sessionId: string;
  dataDir?: string;
  provider?: string;
  model?: string;
  credentials?: CredentialsStore;
}
