import type { Context, GloveFoldArgs, IGloveRunnable } from "glove-core";
import { readTool } from "./read.ts";
import { writeTool } from "./write.ts";
import { editTool } from "./edit.ts";
import { bashTool } from "./bash.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { lsTool } from "./ls.ts";
import { webFetchTool } from "./webfetch.ts";
import { transmissionTool } from "./transmission.ts";
import { fleetDispatchTool } from "./fleet-dispatch.ts";
import { askConfirmTool, askChoiceTool, askTextTool, showInfoTool } from "./modals.ts";
import type { GlorpFleet } from "../fleet/types.ts";

export const TOOL_NAMES = [
  "read", "write", "edit", "bash", "glob", "grep", "ls", "web_fetch",
  "transmission", "dispatch_fleet",
  "ask_confirm", "show_info", "ask_choice", "ask_text",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolEnv {
  workspace: string;
  dataDir: string;
  fleet?: GlorpFleet;
  contextRef?: { current: Context | null };
}

type Factory = (env: ToolEnv) => GloveFoldArgs<any>;

const FACTORIES: Record<ToolName, Factory> = {
  read: (e) => readTool(e.workspace),
  write: (e) => writeTool(e.workspace),
  edit: (e) => editTool(e.workspace),
  bash: (e) => bashTool(e.workspace),
  glob: (e) => globTool(e.workspace),
  grep: (e) => grepTool(e.workspace),
  ls: (e) => lsTool(e.workspace),
  web_fetch: () => webFetchTool,
  transmission: (e) => transmissionTool(e.dataDir),
  dispatch_fleet: (e) => {
    if (!e.fleet || !e.contextRef) {
      throw new Error("dispatch_fleet requires a fleet + contextRef in ToolEnv");
    }
    return fleetDispatchTool(e.fleet, e.contextRef);
  },
  ask_confirm: () => askConfirmTool,
  show_info: () => showInfoTool,
  ask_choice: () => askChoiceTool,
  ask_text: () => askTextTool,
};

/** Build a single tool's fold args by name. */
export function buildTool(name: ToolName, env: ToolEnv): GloveFoldArgs<any> {
  const factory = FACTORIES[name];
  if (!factory) throw new Error(`Unknown tool: ${name}`);
  return factory(env);
}

/** Register a named set of tools onto a Glove instance/builder. */
export function registerTools<T extends { fold: (args: GloveFoldArgs<any>) => T }>(
  target: T,
  names: readonly ToolName[],
  env: ToolEnv,
): T {
  for (const name of names) target.fold(buildTool(name, env));
  return target;
}

/** Default read-only tool set used by subagents that don't declare their own. */
export const DEFAULT_SUBAGENT_TOOLS: readonly ToolName[] = [
  "read", "grep", "glob", "ls", "web_fetch",
];

/** Tools the main glorp agent exposes by default. */
export const MAIN_AGENT_TOOLS: readonly ToolName[] = [
  "read", "write", "edit", "bash", "glob", "grep", "ls", "web_fetch",
  "transmission", "dispatch_fleet",
  "ask_confirm", "show_info", "ask_choice", "ask_text",
];

/** Normalise a user-supplied tool name (case + aliases) to a canonical name. */
export function normaliseToolName(raw: string): ToolName | null {
  const lower = raw.trim().toLowerCase();
  if (lower === "webfetch") return "web_fetch";
  if (TOOL_NAMES.includes(lower as ToolName)) return lower as ToolName;
  return null;
}

/** Like `Map<ToolName, IGloveRunnable>` — for tests that need to inspect what's registered. */
export type RegisteredTools = ReadonlyMap<ToolName, IGloveRunnable>;
