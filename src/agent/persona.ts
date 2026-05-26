import { GLORP_VERSION, GLORP_CODENAME } from "../shared/version.ts";
import type { ExtensionsBundle } from "./extensions-loader.ts";
import { readPrompt } from "./prompts/loader.ts";
import { buildProjectInstructionsContext } from "./project-instructions.ts";
import { xmlSection } from "./prompts/synthetic.ts";
import { buildExtensionsContext } from "./skills-context.ts";

export interface SystemPromptOptions {
  workspace: string;
  contextLimit: number;
  extensions: ExtensionsBundle;
}

export function buildGlorpSystemPrompt(opts: SystemPromptOptions): string {
  return [
    readPrompt("agents/main.md", { DATE: new Date().toISOString().slice(0, 10) }),
    runtimeContext(opts.workspace),
    buildProjectInstructionsContext({
      workspace: opts.workspace,
      contextLimit: opts.contextLimit,
    }),
    buildExtensionsContext(opts.extensions, { contextLimit: opts.contextLimit }),
  ].filter(Boolean).join("\n\n");
}

export function builtInAgentPrompt(
  name: "planner" | "researcher" | "reviewer" | "generator" | "evaluator" | "builder",
): string {
  return readPrompt(`agents/${name}.md`);
}

export const COMPACTION_INSTRUCTIONS = readPrompt("compaction.md");

function runtimeContext(workspace: string): string {
  return xmlSection("glorp_runtime", {}, [
    `version: ${GLORP_VERSION} (${GLORP_CODENAME})`,
    `workspace: ${workspace}`,
  ].join("\n"));
}
