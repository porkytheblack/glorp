import { buildSubAgent } from "./factory.ts";
import { plannerDef } from "./planner.ts";
import { researcherDef } from "./researcher.ts";
import { reviewerDef } from "./reviewer.ts";
import type { SubAgentDef, SubAgentDeps, SubAgentFactoryResult } from "./types.ts";

/** Canonical list of subagents the binary ships with. */
export const BUILT_IN_SUBAGENTS: readonly SubAgentDef[] = [
  plannerDef,
  researcherDef,
  reviewerDef,
];

/**
 * Materialise every built-in subagent into the `DefineSubAgentArgs` shape
 * glove's builder expects. Call this once per `buildGlorp()`.
 */
export function buildBuiltInSubAgents(deps: SubAgentDeps): SubAgentFactoryResult[] {
  return BUILT_IN_SUBAGENTS.map((def) => buildSubAgent({ def, ...deps }));
}

export { plannerDef, researcherDef, reviewerDef };
export type { SubAgentDef, SubAgentDeps, SubAgentFactoryResult } from "./types.ts";
export { buildSubAgent } from "./factory.ts";
export { buildDiskSubAgent } from "./disk.ts";
