import type { IGloveRunnable } from "glove-core/glove";
import type { GlorpFleet } from "./station-bridge.ts";
import type { GlorpStore } from "./store.ts";
import type { CredentialsStore } from "./credentials.ts";

export interface ExtensionCatalogue {
  slash: Array<{ name: string; description: string }>;
  mentions: Array<{ name: string; description: string }>;
}

export interface GlorpHandle {
  agent: IGloveRunnable;
  fleet: GlorpFleet;
  store: GlorpStore;
  credentials: CredentialsStore;
  sessionId: string;
  modelLabel: string;
  extensions: ExtensionCatalogue;
  send(text: string): Promise<void>;
  abort(): void;
  shutdown(): Promise<void>;
  swapProfile(profileId: string): Promise<void>;
  resolveSlot(slotId: string, value: unknown): void;
  rejectSlot(slotId: string, reason?: string): void;
  resolvePermission(slotId: string, allow: boolean): void;
  clearPermission(toolName: string): Promise<void>;
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
