import * as path from "node:path";
import * as os from "node:os";
import { buildSubAgent } from "./agents/factory.ts";
import { plannerDef } from "./agents/planner.ts";
import { researcherDef } from "./agents/researcher.ts";
import { reviewerDef } from "./agents/reviewer.ts";
import type { SubAgentFactoryResult } from "./agents/types.ts";

interface Deps {
  workspace: string;
  dataDir?: string;
}

function withDefaults({ workspace, dataDir }: Deps): { workspace: string; dataDir: string } {
  return { workspace, dataDir: dataDir ?? path.join(os.homedir(), ".glorp") };
}

/**
 * Back-compat surface for tests / callers that imported the named factories
 * directly. New code should add subagent definitions under `src/agent/agents/`
 * and rely on `buildBuiltInSubAgents`.
 */
export function plannerSubAgent(deps: Deps): SubAgentFactoryResult {
  return buildSubAgent({ def: plannerDef, ...withDefaults(deps) });
}

export function researcherSubAgent(deps: Deps): SubAgentFactoryResult {
  return buildSubAgent({ def: researcherDef, ...withDefaults(deps) });
}

export function reviewerSubAgent(deps: Deps): SubAgentFactoryResult {
  return buildSubAgent({ def: reviewerDef, ...withDefaults(deps) });
}
