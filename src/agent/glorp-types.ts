import type { IGloveRunnable } from "glove-core/glove";
import type { PermissionStatus, ContentPart } from "glove-core/core";
import type { AgentInfo } from "../shared/events.ts";
import type { Orchestrator } from "../orchestrator/orchestrator.ts";
import type { GlorpStore } from "./store.ts";
import type { CredentialsStore } from "./credentials.ts";
import type { ModelCatalog } from "./model-catalog.ts";
import type { ProjectConfig } from "./project-config.ts";
import type { PermissionMode } from "./runtime/permission-mode.ts";

export interface ExtensionCatalogue {
  slash: Array<{ name: string; description: string }>;
  skills: Array<{ name: string; description: string }>;
  mentions: Array<{ name: string; description: string }>;
}

export interface GlorpHandle {
  agent: IGloveRunnable;
  orchestrator: Orchestrator;
  store: GlorpStore;
  credentials: CredentialsStore;
  sessionId: string;
  modelLabel: string;
  title: string | null;
  extensions: ExtensionCatalogue;
  send(text: string, images?: Array<{ data: string; media_type: string }>): Promise<void>;
  /** Run the plan phase then a build phase for a complex request. */
  planAndBuild(prompt: string): Promise<void>;
  abort(): void;
  shutdown(): Promise<void>;
  swapProfile(profileId: string): Promise<void>;
  resolveSlot(slotId: string, value: unknown): void;
  rejectSlot(slotId: string, reason?: string): void;
  resolvePermission(slotId: string, allow: boolean): void;
  /** Stop a running orchestrated agent by ID. */
  stopAgent(agentId: string, reason?: string): Promise<void>;
  /** Promote a background agent to foreground. Returns false if not found. */
  promoteAgent(agentId: string): boolean;
  /** The conversational agent roster — every agent the user can chat with. */
  listAgents(): AgentInfo[];
  /** The id of the active conversational agent (input + transcript target). */
  readonly activeAgentId: string;
  /** Make a conversational agent active: swaps the live transcript + input target. */
  switchAgent(agentId: string): Promise<void>;
  /** Spin up a new conversational agent (own transcript + persona) and switch to it. Returns its id. */
  addAgent(opts: { role: string; label?: string }): Promise<string>;
  /** Remove a conversational agent and delete its transcript. The default agent cannot be removed. */
  removeAgent(agentId: string): Promise<void>;
  /** Sweep every persisted grant for a tool name (legacy "always allow X" UX). */
  clearPermission(toolName: string): Promise<void>;
  /** Surgically clear a single canonical permission key (e.g. `bash:git`). */
  clearPermissionKey(key: string): Promise<void>;
  /** Live snapshot of persisted permission grants for the Ctrl+P overlay. */
  listPermissions(): Array<{ key: string; status: PermissionStatus }>;
  onLabelChange(fn: (label: string) => void): () => void;
  hydrateUi(): Promise<void>;
  /** Catalog of model metadata (context, cost, capabilities) for the UI. */
  catalog: ModelCatalog;
  /** Active project config merged from glorp.json layers. */
  projectConfig: ProjectConfig;
  /** Current permission mode (normal / auto / bypass). */
  readonly permissionMode: PermissionMode;
  /** Change the permission mode at runtime. Emits a bridge event. */
  setPermissionMode(mode: PermissionMode): void;
}

export interface BuildGlorpOptions {
  workspace: string;
  sessionId: string;
  dataDir?: string;
  provider?: string;
  model?: string;
  credentials?: CredentialsStore;
  /**
   * Controls how tool-execution permission prompts are handled.
   *   "normal"  — ask the user every time (default)
   *   "auto"    — auto-approve safe ops; escalate destructive + interactive
   *   "bypass"  — auto-approve everything; zero permission prompts
   */
  permissionMode?: PermissionMode;
}
