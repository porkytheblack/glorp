/**
 * Orchestrated build flow: plan phase → gen-eval loop.
 * Triggered by `/build <prompt>` in the input bar.
 */

import type { Orchestrator } from "../../orchestrator/orchestrator.ts";
import type { BridgeEvent } from "../../shared/events.ts";
import { FEATURE_COMPLETE } from "../../orchestrator/checkpoints.ts";
import { generatorBlueprint, evaluatorBlueprint } from "../../orchestrator/blueprints.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
}

/** Returns the user's prompt if the text is a `/build` command, else null. */
export function parseBuildCommand(text: string): string | null {
  return text.match(/^\/build\s+([\s\S]+)/)?.[1]?.trim() ?? null;
}

/**
 * Run the full orchestrated build: plan phase (generator drafts,
 * evaluator checks, user accepts) then gen-eval build loop.
 */
export async function runOrchestratorBuild(
  orchestrator: Orchestrator,
  bridge: Bridge,
  workspace: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<void> {
  const plan = await orchestrator.planPhase(prompt, signal);
  if (!plan.accepted) return;
  const { title, body } = plan;
  bridge.emit({
    type: "plan",
    plan: { title, body, revision: 1, updatedAt: new Date().toISOString() },
  });
  const sfx = Date.now().toString(36);
  await orchestrator.runLoop({
    loopId: `build_${sfx}`,
    generatorBlueprint: generatorBlueprint({ workspace, idSuffix: sfx }),
    evaluatorBlueprint: evaluatorBlueprint({ workspace, idSuffix: sfx }),
    checkpoints: [FEATURE_COMPLETE],
    initialPrompt: `Implement this accepted plan:\n\n# ${title}\n\n${body}`,
  }, signal);
}
