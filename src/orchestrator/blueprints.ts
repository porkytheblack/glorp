/**
 * Built-in agent blueprints for common orchestration roles.
 * Each blueprint is derived from the role registry — the registry is the
 * single source of truth for prompts, tools, and capabilities.
 */

import type { AgentBlueprint } from "./types.ts";
import { agentId } from "./types.ts";
import { roleDef, rolePrompt, ROLE_DEFS } from "./role-registry.ts";

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
    registryRole: role,
    tools: [...def.tools],
    capabilities: [...def.capabilities],
    systemPrompt: rolePrompt(role),
  };
}

/**
 * Map a spawn role to the subprocess agent it should run as.
 * Read-only roles use "researcher", write-capable ones use "builder".
 */
const SUBPROCESS_ROLE: Record<string, string> = {
  builder: "builder",
  generator: "generator",
  researcher: "researcher",
  evaluator: "evaluator",
  planner: "researcher",   // read-only → researcher subprocess
  reviewer: "researcher",  // read-only → researcher subprocess
};

/** Loop role for each spawn role. */
const LOOP_ROLE: Record<string, "generator" | "evaluator" | "autonomous"> = {
  builder: "autonomous",
  generator: "generator",
  researcher: "autonomous",
  evaluator: "evaluator",
  planner: "autonomous",
  reviewer: "autonomous",
};

/**
 * Build a blueprint for a spawn_agent call. Supports all registry roles
 * and optional system_prompt / tools overrides for custom personas.
 */
export function blueprintForSpawn(opts: {
  workspace: string;
  role: string;
  label: string;
  systemPrompt?: string;
  tools?: string[];
}): AgentBlueprint {
  const role = opts.role;
  if (!ROLE_DEFS[role]) throw new Error(`Unknown role: ${role}`);

  const def = roleDef(role);
  const suffix = `${opts.label}_${Date.now().toString(36)}`;
  return {
    id: agentId(`${role}_${suffix}`),
    label: opts.label,
    role: LOOP_ROLE[role] ?? "autonomous",
    registryRole: SUBPROCESS_ROLE[role] ?? "builder",
    tools: opts.tools ? [...opts.tools] : [...def.tools],
    capabilities: [...def.capabilities],
    systemPrompt: opts.systemPrompt ?? rolePrompt(role),
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

export function plannerBlueprint(opts: BlueprintOpts): AgentBlueprint {
  return blueprintFromRole("planner", "autonomous", opts);
}

export function reviewerBlueprint(opts: BlueprintOpts): AgentBlueprint {
  return blueprintFromRole("reviewer", "autonomous", opts);
}
