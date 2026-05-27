/**
 * Orchestrated build flow: plan → implement → verify.
 * Triggered by `/build <prompt>` in the input bar.
 *
 * Pipeline phases:
 *   1. Plan phase — requirements gathering + user acceptance
 *   2. Implementation phase — gen-eval loop with IMPLEMENTATION_COMPLETE
 *   3. Verification phase — run typecheck/test/lint, gen-eval fix loop if needed
 */

import type { Orchestrator } from "../../orchestrator/orchestrator.ts";
import type { BridgeEvent } from "../../shared/events.ts";
import type { PlanResult } from "../../orchestrator/plan-phase.ts";
import { IMPLEMENTATION_COMPLETE, VERIFICATION_PASSED } from "../../orchestrator/checkpoints.ts";
import { generatorBlueprint, evaluatorBlueprint } from "../../orchestrator/blueprints.ts";
import { discoverWorkspaceContext } from "../../orchestrator/workspace-context.ts";
import { runVerification, defaultVerificationCommands } from "../../orchestrator/verification.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
}

/** Returns the user's prompt if the text is a `/build` command, else null. */
export function parseBuildCommand(text: string): string | null {
  return text.match(/^\/build\s+([\s\S]+)/)?.[1]?.trim() ?? null;
}

/**
 * Run the full orchestrated build pipeline:
 *   plan → implement (gen-eval) → verify (automated + gen-eval fix loop).
 */
export async function runOrchestratorBuild(
  orchestrator: Orchestrator,
  bridge: Bridge,
  workspace: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<void> {
  // Phase 1 — Plan: requirements gathering, plan creation, user acceptance
  const plan = await orchestrator.planPhase(prompt, signal);
  if (!plan.accepted) return;
  bridge.emit({
    type: "plan",
    plan: {
      title: plan.title,
      body: plan.body,
      revision: 1,
      updatedAt: new Date().toISOString(),
    },
  });

  const sfx = Date.now().toString(36);

  // Phase 2 — Implement: generator writes code, evaluator checks completeness
  await orchestrator.runLoop({
    loopId: `impl_${sfx}`,
    generatorBlueprint: generatorBlueprint({ workspace, idSuffix: `impl_${sfx}` }),
    evaluatorBlueprint: evaluatorBlueprint({ workspace, idSuffix: `impl_${sfx}` }),
    checkpoints: [IMPLEMENTATION_COMPLETE],
    initialPrompt: `Implement this accepted plan:\n\n# ${plan.title}\n\n${plan.body}`,
    maxRetries: 3,
  }, signal);

  // Phase 3 — Verify: automated checks + gen-eval fix loop when failures occur
  await runVerificationPhase(orchestrator, workspace, plan, sfx, signal);
}

/**
 * Verification phase: run automated checks first; if all pass, skip the
 * gen-eval loop. If any fail, run a fix loop where the generator gets the
 * failure output and the evaluator re-verifies after each attempt.
 */
async function runVerificationPhase(
  orchestrator: Orchestrator,
  workspace: string,
  plan: PlanResult,
  sfx: string,
  signal?: AbortSignal,
): Promise<void> {
  const ctx = await discoverWorkspaceContext(workspace);
  const commands = defaultVerificationCommands(ctx);

  // No verification commands detected — nothing to verify against
  if (commands.length === 0) return;

  // Run verification once before entering the fix loop
  const initial = await runVerification(workspace, commands, { signal });
  if (initial.allPassed) return;

  // Failures detected — enter a gen-eval loop to fix them.
  // The enrichArtifact hook re-runs verification after each generator attempt
  // so the evaluator always judges against fresh results.
  await orchestrator.runLoop({
    loopId: `verify_${sfx}`,
    generatorBlueprint: generatorBlueprint({ workspace, idSuffix: `verify_${sfx}` }),
    evaluatorBlueprint: evaluatorBlueprint({ workspace, idSuffix: `verify_${sfx}` }),
    checkpoints: [VERIFICATION_PASSED],
    initialPrompt: buildVerificationFixPrompt(plan, initial.detailBlock),
    maxRetries: 3,
    enrichArtifact: async (text) => {
      const freshCtx = await discoverWorkspaceContext(workspace);
      const freshCmds = defaultVerificationCommands(freshCtx);
      if (freshCmds.length === 0) return text;
      const report = await runVerification(workspace, freshCmds, { signal });
      return `${text}\n\n---\n${report.detailBlock}`;
    },
  }, signal);
}

function buildVerificationFixPrompt(plan: PlanResult, failureBlock: string): string {
  return [
    "Automated verification failed after implementing the plan.",
    "Your task is to fix the failures described below.",
    "",
    `# Plan: ${plan.title}`,
    "",
    plan.body,
    "",
    "---",
    "",
    failureBlock,
    "",
    "Fix the failing checks. Do not break passing checks.",
    "After making changes, the verification suite will be re-run automatically.",
  ].join("\n");
}
