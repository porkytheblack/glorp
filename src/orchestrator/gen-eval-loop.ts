/**
 * Generate-evaluate loop state machine.
 * Drives checkpoint-gated cycles between a generator and evaluator.
 *
 * The generator is built ONCE per checkpoint and reused across retries
 * so it keeps its full conversation history (questions asked, tools called,
 * feedback incorporated). The evaluator is rebuilt each attempt since it
 * judges a single artifact snapshot.
 */

import type { ModelAdapter, SubscriberAdapter } from "glove-core/core";
import type { ResourceFsAdapter } from "glove-memory";
import type { AgentBlueprint, Checkpoint, GenEvalLoopOptions, LoopPhase, OrchestratorEvent, Verdict } from "./types.ts";
import { formatCriteriaBlock, parseVerdict } from "./checkpoints.ts";
import { buildAgentFromBlueprint } from "./agent-factory.ts";
import { teardownAgentMesh } from "./mesh-setup.ts";
import { ForwardingDisplayManager } from "./forwarding-display.ts";
import { GlorpStore } from "../agent/store.ts";
import { extractText, buildRetryPrompt, emitAgentStats, isAbort, withWorkspaceContext } from "./loop-utils.ts";

const DEFAULT_MAX_RETRIES = 3;

export interface LoopDeps {
  model: ModelAdapter;
  contextLimit: number;
  emit: (event: OrchestratorEvent) => void;
  workspace: string;
  dataDir: string;
  meshDir: string;
  /** Shared resource filesystem for plan/artifact persistence across agents. */
  resources?: ResourceFsAdapter;
  /** Called when a background agent forwards a permission slot. */
  trackForwardedSlot: (slotId: string, dm: ForwardingDisplayManager) => void;
  /** Factory for subscribers that forward agent events to the UI. */
  createSubscriber?: () => SubscriberAdapter;
  /** Abort signal from the consumer — cancels model calls and rejects pending display slots. */
  signal?: AbortSignal;
  /** Workspace context block to inject into agent system prompts. */
  workspaceContext?: string;
}

/**
 * Run a full generate-evaluate loop through all checkpoints.
 * Returns the final verdict (proceed or terminate).
 */
export async function runGenEvalLoop(
  opts: GenEvalLoopOptions,
  deps: LoopDeps,
): Promise<Verdict> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let currentPrompt = opts.initialPrompt;

  for (const checkpoint of opts.checkpoints) {
    deps.emit({ type: "loop_phase", loopId: opts.loopId, phase: "generating" });
    const result = await runCheckpoint(checkpoint, currentPrompt, opts, deps, maxRetries);
    deps.emit({ type: "verdict", loopId: opts.loopId, checkpoint: checkpoint.name, verdict: result });

    if (result.action === "terminate") {
      deps.emit({ type: "loop_phase", loopId: opts.loopId, phase: "terminated" });
      return result;
    }
    if (result.action === "proceed" && result.note) {
      currentPrompt = `Previous checkpoint (${checkpoint.name}) passed. Note: ${result.note}\n\nOriginal task:\n${opts.initialPrompt}\n\nContinue with the next phase.`;
    }
  }

  deps.emit({ type: "loop_phase", loopId: opts.loopId, phase: "completed" });
  return { action: "proceed", note: "All checkpoints passed." };
}

/**
 * Run a single checkpoint: build the generator once, loop retries.
 * The generator keeps conversation state so evaluator feedback is additive.
 */
async function runCheckpoint(
  checkpoint: Checkpoint,
  prompt: string,
  opts: GenEvalLoopOptions,
  deps: LoopDeps,
  maxRetries: number,
): Promise<Verdict> {
  const genBp = deps.workspaceContext ? withWorkspaceContext(opts.generatorBlueprint, deps.workspaceContext) : opts.generatorBlueprint;
  const genStore = new GlorpStore(`orch_${opts.generatorBlueprint.id}`, deps.dataDir);
  const display = makeDisplay("generator", opts.generatorBlueprint.id, opts, deps);
  const { runnable: generator, meshAdapter } = await buildAgentFromBlueprint(
    genBp, {
      workspace: deps.workspace, dataDir: deps.dataDir, resources: deps.resources,
      model: deps.model, contextLimit: deps.contextLimit, display: display as any,
      meshDir: deps.meshDir, subscriber: deps.createSubscriber?.(), store: genStore,
    },
  );

  try {
    let attempt = 0;
    let generatorPrompt = prompt;

    while (attempt <= maxRetries) {
      deps.signal?.throwIfAborted();
      const result = await generator.processRequest(generatorPrompt, deps.signal);
      await emitAgentStats(genStore, opts.generatorBlueprint, "generating", deps.emit);
      let artifact = extractText(result);
      if (opts.enrichArtifact) artifact = await opts.enrichArtifact(artifact);
      deps.emit({ type: "loop_phase", loopId: opts.loopId, phase: "evaluating" });

      deps.signal?.throwIfAborted();
      const verdict = await runEvaluator(artifact, checkpoint, opts, deps);
      deps.emit({ type: "loop_phase", loopId: opts.loopId, phase: "checkpoint" });

      if (verdict.action === "proceed" || verdict.action === "terminate") return verdict;

      attempt++;
      if (attempt > maxRetries) {
        return {
          action: "terminate",
          reason: `Max retries (${maxRetries}) exceeded at "${checkpoint.name}". Last feedback: ${verdict.feedback}`,
        };
      }
      generatorPrompt = buildRetryPrompt(prompt, verdict.feedback, attempt, maxRetries);
      deps.emit({ type: "loop_phase", loopId: opts.loopId, phase: "generating" });
    }
    return { action: "terminate", reason: "Loop exhausted retries." };
  } catch (err) {
    if (isAbort(err, deps.signal)) throw err;
    return { action: "terminate", reason: `Agent error at "${checkpoint.name}": ${(err as Error)?.message ?? err}` };
  } finally {
    if (meshAdapter) await teardownAgentMesh(meshAdapter).catch(() => {});
  }
}

async function runEvaluator(
  artifact: string,
  checkpoint: Checkpoint,
  opts: GenEvalLoopOptions,
  deps: LoopDeps,
): Promise<Verdict> {
  // Fresh store per evaluation so prior retry context doesn't bleed in.
  const store = new GlorpStore(`orch_eval_${Date.now().toString(36)}`, deps.dataDir);
  const prompt = [
    formatCriteriaBlock(checkpoint),
    "",
    "## Generator Output",
    artifact,
    "",
    "Evaluate the output above against the checkpoint criteria.",
    "Use bash to run verification commands (typecheck, tests, lint) to independently confirm claims.",
    "Respond with a JSON verdict: { action, note?, feedback?, reason? }",
  ].join("\n");

  const evalBp = deps.workspaceContext ? withWorkspaceContext(opts.evaluatorBlueprint, deps.workspaceContext) : opts.evaluatorBlueprint;
  const display = makeDisplay("evaluator", opts.evaluatorBlueprint.id, opts, deps);
  const { runnable, meshAdapter } = await buildAgentFromBlueprint(evalBp, {
    workspace: deps.workspace, dataDir: deps.dataDir, contextLimit: deps.contextLimit,
    model: deps.model, display: display as any, meshDir: deps.meshDir,
    subscriber: deps.createSubscriber?.(), store,
  });
  try {
    const result = await runnable.processRequest(prompt, deps.signal);
    await emitAgentStats(store, opts.evaluatorBlueprint, "evaluating", deps.emit);
    return parseVerdict(extractText(result));
  } finally {
    if (meshAdapter) await teardownAgentMesh(meshAdapter).catch(() => {});
  }
}

/** Create a forwarding display manager for a loop agent. */
function makeDisplay(
  role: "generator" | "evaluator",
  agentId: string,
  opts: GenEvalLoopOptions,
  deps: LoopDeps,
): ForwardingDisplayManager {
  const isForeground = (opts.foregroundRole ?? "generator") === role;
  const dm: ForwardingDisplayManager = new ForwardingDisplayManager(agentId, (slot) => {
    deps.trackForwardedSlot(slot.slotId, dm);
    deps.emit({ type: "slot_forwarded", ...slot });
  }, isForeground);
  if (deps.signal) deps.signal.addEventListener("abort", () => void dm.clearStack(), { once: true });
  return dm;
}
