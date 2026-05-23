import { Glove } from "glove-core/glove";
import type { DefineSubAgentArgs } from "glove-core/extensions";
import { GlorpStore } from "../store.ts";
import { builtInAgentPrompt } from "../persona.ts";
import { createToolRegistry, registerTools } from "../tools/registry.ts";
import * as os from "node:os";
import * as path from "node:path";

interface SubAgentDeps {
  workspace: string;
  dataDir?: string;
}

interface BuiltInSubAgent {
  name: "planner" | "researcher" | "reviewer";
  description: string;
  tools: readonly string[];
  maxTurns: number;
  compaction: string;
}

const BUILT_INS: Record<BuiltInSubAgent["name"], BuiltInSubAgent> = {
  planner: {
    name: "planner",
    description:
      "Designs an approach without writing code. Use for planning requests and architecture tradeoffs.",
    tools: ["read", "grep", "glob", "ls"],
    maxTurns: 6,
    compaction: "Preserve the plan and open questions.",
  },
  researcher: {
    name: "researcher",
    description:
      "Investigates code or docs and returns a tight answer with file:line citations.",
    tools: ["read", "grep", "glob", "ls", "web_fetch"],
    maxTurns: 12,
    compaction: "Preserve findings and citations; drop search-step chatter.",
  },
  reviewer: {
    name: "reviewer",
    description:
      "Second opinion reviewer that returns a punch-list for substantial code changes.",
    tools: ["read", "grep", "glob"],
    maxTurns: 8,
    compaction: "Preserve findings; drop file-reading narration.",
  },
};

export function plannerSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return makeBuiltInSubAgent(BUILT_INS.planner, deps);
}

export function researcherSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return makeBuiltInSubAgent(BUILT_INS.researcher, deps);
}

export function reviewerSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return makeBuiltInSubAgent(BUILT_INS.reviewer, deps);
}

function makeBuiltInSubAgent(
  config: BuiltInSubAgent,
  deps: SubAgentDeps,
): DefineSubAgentArgs {
  return {
    name: config.name,
    description: config.description,
    factory: async ({ parentStore, parentControls }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.(config.name, false)) ??
        new GlorpStore(
          `${config.name}_${Date.now()}`,
          deps.dataDir ?? path.join(os.tmpdir(), "glorp-subagents"),
        );
      const child = new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt: builtInAgentPrompt(config.name),
        compaction_config: {
          compaction_instructions: config.compaction,
          max_turns: config.maxTurns,
        },
      });
      registerTools(child, createToolRegistry(deps), config.tools);
      return child.build();
    },
  };
}
