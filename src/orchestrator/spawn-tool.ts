/**
 * Tool that lets an agent create child agents at runtime.
 * Replaces the old dispatch_fleet tool with a general-purpose primitive.
 */

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { Orchestrator } from "./orchestrator.ts";
import { agentId } from "./types.ts";
import type { AgentBlueprint, Slot } from "./types.ts";
import {
  generatorBlueprint,
  evaluatorBlueprint,
  researchBlueprint,
  builderBlueprint,
} from "./blueprints.ts";

const ROLE_MAP = {
  generator: generatorBlueprint,
  evaluator: evaluatorBlueprint,
  researcher: researchBlueprint,
  builder: builderBlueprint,
} as const;

type SpawnInput = {
  label: string;
  role: keyof typeof ROLE_MAP;
  task: string;
  tools?: string[];
  slot?: Slot;
};

export function spawnAgentTool(
  orchestrator: Orchestrator,
  workspace: string,
): GloveFoldArgs<SpawnInput> {
  return {
    name: "spawn_agent",
    description:
      "Spawn a new agent to work on a task in parallel. " +
      "Pick a role: 'generator' (full tools, interactive), 'evaluator' (read-only, verification), " +
      "'researcher' (read + web, investigation), 'builder' (full tools, implementation). " +
      "The agent runs in a subprocess and communicates results via mesh messaging. " +
      "Use this when work can be parallelized or when a specialized agent would be more effective.",
    requiresPermission: true,
    inputSchema: z.object({
      label: z.string().min(1).max(80).describe("Short descriptive label for the agent"),
      role: z.enum(["generator", "evaluator", "researcher", "builder"]).describe("Agent role"),
      task: z.string().min(1).describe("The task prompt for the spawned agent"),
      tools: z.array(z.string()).optional().describe("Override default tools for the role"),
      slot: z.enum(["foreground", "background"]).optional().describe("Scheduling slot (default: background)"),
    }),
    async do(input) {
      const slot: Slot = input.slot ?? "background";
      const factory = ROLE_MAP[input.role];
      const blueprint: AgentBlueprint = {
        ...factory({ workspace, idSuffix: `${input.label}_${Date.now().toString(36)}` }),
        label: input.label,
      };

      if (input.tools) {
        blueprint.tools = input.tools;
      }

      try {
        const managed = await orchestrator.spawnAgent(blueprint, slot, input.task);
        return {
          status: "success",
          data: `Spawned agent "${input.label}" (${input.role}) in ${slot} slot. ` +
                `Agent ID: ${managed.id}. Run ID: ${managed.runId}. ` +
                `Results will arrive via mesh messaging.`,
          renderData: {
            agentId: managed.id,
            runId: managed.runId,
            label: input.label,
            role: input.role,
            slot,
          },
        };
      } catch (err: any) {
        return {
          status: "error",
          data: null,
          message: `Failed to spawn agent: ${err?.message ?? String(err)}`,
        };
      }
    },
  };
}
