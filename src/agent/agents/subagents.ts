/**
 * Built-in subagent factories for planner, researcher, and reviewer.
 * Role configuration (prompt, tools, compaction) comes from the registry.
 */

import { Glove } from "glove-core/glove";
import type { DefineSubAgentArgs } from "glove-core/extensions";
import { GlorpStore } from "../store.ts";
import { createToolRegistry, registerTools } from "../tools/registry.ts";
import { roleDef, rolePrompt } from "../../orchestrator/role-registry.ts";
import * as os from "node:os";
import * as path from "node:path";

interface SubAgentDeps {
  workspace: string;
  dataDir?: string;
}

/** Subagent roles available to the main agent via glove_invoke_subagent. */
const SUBAGENT_ROLES = ["planner", "researcher", "reviewer"] as const;
type SubAgentRole = (typeof SUBAGENT_ROLES)[number];

export function plannerSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return buildSubAgent("planner", deps);
}

export function researcherSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return buildSubAgent("researcher", deps);
}

export function reviewerSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return buildSubAgent("reviewer", deps);
}

function buildSubAgent(role: SubAgentRole, deps: SubAgentDeps): DefineSubAgentArgs {
  const def = roleDef(role);
  return {
    name: role,
    description: def.description,
    factory: async ({ parentStore, parentControls }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.(role, false)) ??
        new GlorpStore(
          `${role}_${Date.now()}`,
          deps.dataDir ?? path.join(os.tmpdir(), "glorp-subagents"),
        );
      const child = new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt: rolePrompt(role),
        compaction_config: {
          compaction_instructions: def.compaction,
          max_turns: def.maxTurns,
        },
      });
      registerTools(child, createToolRegistry(deps), def.tools);
      return child.build();
    },
  };
}
