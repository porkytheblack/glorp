import type { GloveFoldArgs } from "glove-core/glove";
import type { Context } from "glove-core/core";
import type { ResourceFsAdapter } from "glove-memory";
import type { Orchestrator } from "../../orchestrator/orchestrator.ts";
import type { GlorpStore } from "../store.ts";
import type { Bridge } from "../../shared/bridge.ts";
import {
  askChoiceTool,
  askConfirmTool,
  askTextTool,
  applyPatchTool,
  bashTool,
  editTool,
  globTool,
  grepTool,
  inboxManageTool,
  listAgentsTool,
  lsTool,
  planTool,
  readTool,
  viewImageTool,
  showInfoTool,
  spawnAgentTool,
  transmissionTool,
  webFetchTool,
  writeTool,
} from "./index.ts";
import { deliverResultTool, reportProgressTool } from "./task.ts";
import type { TaskSink } from "../task-sink.ts";

export const MAIN_AGENT_TOOLS = [
  "read",
  "view_image",
  "write",
  "edit",
  "apply_patch",
  "glorp_update_plan",
  "bash",
  "glob",
  "grep",
  "ls",
  "web_fetch",
  "transmission",
  "spawn_agent",
  "list_agents",
  "ask_confirm",
  "show_info",
  "ask_choice",
  "ask_text",
] as const;

export const READ_ONLY_TOOLS = ["read", "view_image", "grep", "glob", "ls", "web_fetch", "list_agents"] as const;

/** Folded in addition to MAIN_AGENT_TOOLS only when a session runs as a task. */
export const TASK_TOOLS = ["deliver_result", "report_progress"] as const;

export type ToolName =
  | "read"
  | "view_image"
  | "write"
  | "edit"
  | "apply_patch"
  | "glorp_update_plan"
  | "bash"
  | "glob"
  | "grep"
  | "ls"
  | "web_fetch"
  | "transmission"
  | "glove_update_inbox"
  | "spawn_agent"
  | "list_agents"
  | "ask_confirm"
  | "show_info"
  | "ask_choice"
  | "ask_text"
  | "deliver_result"
  | "report_progress";

export interface ToolRegistryDeps {
  workspace: string;
  /** Per-session env injected into bash spawns (e.g. GLORP_SESSION_ID). */
  sessionEnv?: Record<string, string>;
  dataDir?: string;
  store?: GlorpStore;
  resources?: ResourceFsAdapter;
  orchestrator?: Orchestrator;
  contextRef?: { current: Context | null };
  /** Session mesh dir — lets list_agents read the shared agent roster. */
  meshDir?: string;
  /** Per-session event bus, so the transmission tool stays session-scoped. */
  bridge?: Bridge;
  /** Present only in task mode — backs deliver_result / report_progress. */
  taskSink?: TaskSink;
}

type ToolFactory = () => GloveFoldArgs<any>;

export function createToolRegistry(deps: ToolRegistryDeps): Record<ToolName, ToolFactory> {
  return {
    read: () => readTool(deps.workspace),
    view_image: () => viewImageTool(deps.workspace),
    write: () => writeTool(deps.workspace),
    edit: () => editTool(deps.workspace),
    apply_patch: () => applyPatchTool(deps.workspace),
    glorp_update_plan: () => planTool(requireDep(deps.store, "store"), deps.resources),
    bash: () => bashTool(deps.workspace, deps.sessionEnv),
    glob: () => globTool(deps.workspace),
    grep: () => grepTool(deps.workspace),
    ls: () => lsTool(deps.workspace),
    web_fetch: () => webFetchTool,
    transmission: () => transmissionTool(requireDep(deps.dataDir, "dataDir"), deps.bridge),
    glove_update_inbox: () => inboxManageTool(requireDep(deps.contextRef?.current, "context")),
    spawn_agent: () =>
      spawnAgentTool(
        requireDep(deps.orchestrator, "orchestrator"),
        deps.workspace,
      ),
    list_agents: () => listAgentsTool(deps.meshDir),
    ask_confirm: () => askConfirmTool,
    show_info: () => showInfoTool,
    ask_choice: () => askChoiceTool,
    ask_text: () => askTextTool,
    deliver_result: () => deliverResultTool(requireDep(deps.taskSink, "taskSink")),
    report_progress: () => reportProgressTool(requireDep(deps.taskSink, "taskSink")),
  };
}

export function registerTools<T extends { fold<I>(args: GloveFoldArgs<I>): T }>(
  glove: T,
  registry: Partial<Record<ToolName, ToolFactory>>,
  names: readonly string[],
): T {
  for (const name of names) {
    const factory = registry[name as ToolName];
    if (factory) glove.fold(factory());
  }
  return glove;
}

function requireDep<T>(value: T | null | undefined, name: string): NonNullable<T> {
  if (value == null) throw new Error(`Tool registry missing ${name}`);
  return value;
}
