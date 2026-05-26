/**
 * Built-in agent blueprints for common orchestration roles.
 * Each blueprint is derived from the role registry — the registry is the
 * single source of truth for prompts, tools, and capabilities.
 */

import type { AgentBlueprint } from "./types.ts";
import { agentId } from "./types.ts";
import { roleDef, rolePrompt } from "./role-registry.ts";

interface BlueprintOpts {
  workspace: string;
  idSuffix?: string;
}

/** Create a blueprint for a given role, using the registry for prompt + tools. */
function blueprintFromRole(
  role: string,
  loopRole: "generator" | "evaluator" | "autonomous",
  opts: BlueprintOpts,
): AgentBlueprint {
  const def = roleDef(role);
  const suffix = opts.idSuffix ?? Date.now().toString(36);
  return {
    id: agentId(`${role}_${suffix}`),
    label: def.name,
    role: loopRole,
    tools: [...def.tools],
    capabilities: [...def.capabilities],
    systemPrompt: rolePrompt(role),
  };
}

export function generatorBlueprint(opts: BlueprintOpts): AgentBlueprint {
  return blueprintFromRole("generator", "generator", opts);
}

export function evaluatorBlueprint(opts: BlueprintOpts): AgentBlueprint {
  return blueprintFromRole("evaluator", "evaluator", opts);
}

export function researchBlueprint(opts: BlueprintOpts): AgentBlueprint {
  return blueprintFromRole("researcher", "autonomous", opts);
}

export function builderBlueprint(opts: BlueprintOpts): AgentBlueprint {
  return blueprintFromRole("builder", "autonomous", opts);
}
