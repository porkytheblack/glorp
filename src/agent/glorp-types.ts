import type { IGloveRunnable } from "glove-core/glove";
import type { PermissionStatus, ContentPart } from "glove-core/core";
import type { AgentInfo, DisplaySlotEvent, McpServerStatus } from "../shared/events.ts";
import type { Orchestrator } from "../orchestrator/orchestrator.ts";
import type { GlorpStore } from "./store.ts";
import type { CredentialsStore } from "./credentials.ts";
import type { ModelCatalog } from "./model-catalog.ts";
import type { ProjectConfig } from "./project-config.ts";
import type { PermissionMode } from "./runtime/permission-mode.ts";
import type { TaskContext } from "./task-deliverable.ts";
import type { Bridge } from "../shared/bridge.ts";

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
  /** Currently-open display slots (own + orchestrator-forwarded) — the same
   *  set replayed on hydrate. Lets a polling REST client read pending questions. */
  openSlots(): DisplaySlotEvent[];
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
  /** Configured MCP servers with live connection state. */
  listMcpServers(): McpServerStatus[];
  /**
   * Connect or disconnect a configured MCP server. Persists the choice and
   * rebuilds the live agent so the bridged tool set matches the new active set.
   */
  setMcpServer(serverId: string, active: boolean): Promise<void>;
}

export interface BuildGlorpOptions {
  workspace: string;
  sessionId: string;
  dataDir?: string;
  provider?: string;
  model?: string;
  credentials?: CredentialsStore;
  /**
   * Per-session event bus. When omitted, falls back to the process-global
   * `getBridge()` singleton (the single-session server's behavior). Garage
   * passes a fresh Bridge per session so concurrent sessions never cross-talk.
   */
  bridge?: Bridge;
  /**
   * Controls how tool-execution permission prompts are handled.
   *   "normal"  — ask the user every time (default)
   *   "auto"    — auto-approve safe ops; escalate destructive + interactive
   *   "bypass"  — auto-approve everything; zero permission prompts
   */
  permissionMode?: PermissionMode;
  /**
   * Present when this session runs as a Garage task: gives the agent its task
   * self-knowledge (preamble + env), the task toolkit (deliver_result,
   * report_progress), and the deliverable contract enforced at delivery.
   */
  task?: TaskContext;
  /**
   * The session runs inside a disposable, per-session sandbox container (Garage)
   * rather than on the user's own machine. The container is the isolation
   * boundary, so the shell guard skips workspace-path confinement (which would
   * otherwise false-positive on routine `/tmp` scratch, `/usr` reads, etc.).
   */
  sandboxed?: boolean;
}
