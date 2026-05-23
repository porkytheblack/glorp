import type { GloveFoldArgs } from "glove-core/glove";
import type { Context } from "glove-core/core";
import type { ResourceFsAdapter } from "glove-memory";
import type { GlorpFleet } from "../station-bridge.ts";
import type { GlorpStore } from "../store.ts";
import {
  askChoiceTool,
  askConfirmTool,
  askTextTool,
  applyPatchTool,
  bashTool,
  editTool,
  fleetDispatchTool,
  globTool,
  grepTool,
  lsTool,
  planTool,
  readTool,
  showInfoTool,
  transmissionTool,
  webFetchTool,
  writeTool,
} from "./index.ts";

export const MAIN_AGENT_TOOLS = [
  "read",
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
  "dispatch_fleet",
  "ask_confirm",
  "show_info",
  "ask_choice",
  "ask_text",
] as const;

export const READ_ONLY_TOOLS = ["read", "grep", "glob", "ls", "web_fetch"] as const;

export type ToolName =
  | "read"
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
  | "dispatch_fleet"
  | "ask_confirm"
  | "show_info"
  | "ask_choice"
  | "ask_text";

export interface ToolRegistryDeps {
  workspace: string;
  dataDir?: string;
  store?: GlorpStore;
  resources?: ResourceFsAdapter;
  fleet?: GlorpFleet;
  contextRef?: { current: Context | null };
}

type ToolFactory = () => GloveFoldArgs<any>;

export function createToolRegistry(deps: ToolRegistryDeps): Record<ToolName, ToolFactory> {
  return {
    read: () => readTool(deps.workspace),
    write: () => writeTool(deps.workspace),
    edit: () => editTool(deps.workspace),
    apply_patch: () => applyPatchTool(deps.workspace),
    glorp_update_plan: () => planTool(requireDep(deps.store, "store"), deps.resources),
    bash: () => bashTool(deps.workspace),
    glob: () => globTool(deps.workspace),
    grep: () => grepTool(deps.workspace),
    ls: () => lsTool(deps.workspace),
    web_fetch: () => webFetchTool,
    transmission: () => transmissionTool(requireDep(deps.dataDir, "dataDir")),
    dispatch_fleet: () =>
      fleetDispatchTool(
        requireDep(deps.fleet, "fleet"),
        requireDep(deps.contextRef, "contextRef"),
      ),
    ask_confirm: () => askConfirmTool,
    show_info: () => showInfoTool,
    ask_choice: () => askChoiceTool,
    ask_text: () => askTextTool,
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

function requireDep<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Tool registry missing ${name}`);
  return value;
}
