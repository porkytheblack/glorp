/**
 * Tool that lets an agent create child agents at runtime.
 * Replaces the old dispatch_fleet tool with a general-purpose primitive.
 *
 * Roles map to base capabilities — the `system_prompt` override lets the
 * orchestrating agent create arbitrary specialist personas (design lead,
 * QA engineer, architect, etc.) on top of a base tool set.
 */

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { Orchestrator } from "./orchestrator.ts";
import type { AgentBlueprint, Slot } from "./types.ts";
import { blueprintForSpawn } from "./blueprints.ts";

const VALID_ROLES = [
  "builder", "researcher", "generator", "evaluator", "planner", "reviewer",
] as const;

type SpawnRole = (typeof VALID_ROLES)[number];

type SpawnInput = {
  label: string;
  role: SpawnRole;
  task: string;
  system_prompt?: string;
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
      "Roles: 'builder' (full read/write tools — implementation, design docs, anything that writes files), " +
      "'researcher' (read + web — investigation, analysis), " +
      "'generator' (full tools + interactive — when the agent may need to ask questions), " +
      "'evaluator' (read-only — verification, review), " +
      "'planner' (read-only — architecture, design), " +
      "'reviewer' (read-only — code review, QA). " +
      "Use system_prompt to specialize any role into a custom persona " +
      "(e.g. role=builder + system_prompt for a 'UI Designer' or 'Test Engineer'). " +
      "Spawn as many agents as needed for complex tasks — they run as " +
      "isolated subprocesses and coordinate via mesh messaging.",
    requiresPermission: true,
    inputSchema: z.object({
      label: z.string().min(1).max(80).describe("Short descriptive label"),
      role: z.enum(VALID_ROLES).describe("Base role (determines tool access)"),
      task: z.string().min(1).describe("The task prompt for the agent"),
      system_prompt: z.string().optional().describe(
        "Custom system prompt to override the role default. " +
        "Use this to create specialist agents (designer, tester, architect, etc.)",
      ),
      tools: z.array(z.string()).optional().describe("Override tools"),
      slot: z.enum(["foreground", "background"]).optional()
        .describe("Scheduling slot (default: background)"),
    }),
    async do(input) {
      const slot: Slot = input.slot ?? "background";
      const blueprint = blueprintForSpawn({
        workspace,
        role: input.role,
        label: input.label,
        systemPrompt: input.system_prompt,
        tools: input.tools,
      });

      // Append mesh reporting directive so the subprocess reports completion.
      const meshDirective =
        "\n\nWhen done, use glove_mesh_send_message to send a completion " +
        "summary to the 'main' agent. Include files changed and verification results.";
      const taskWithMesh = input.task + meshDirective;

      try {
        const managed = await orchestrator.spawnAgent(blueprint, slot, taskWithMesh);
        return {
          status: "success",
          data:
            `Spawned agent "${input.label}" (${input.role}) in ${slot} slot. ` +
            `Agent ID: ${managed.id}. Run ID: ${managed.runId}. ` +
            `Results will arrive via mesh messaging.`,
          renderData: {
            agentId: managed.id, runId: managed.runId,
            label: input.label, role: input.role, slot,
          },
        };
      } catch (err: any) {
        return {
          status: "error", data: null,
          message: `Failed to spawn agent: ${err?.message ?? String(err)}`,
        };
      }
    },
  };
}
