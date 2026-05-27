/**
 * Plan phase: a specialization of the gen-eval loop for requirements
 * gathering and plan creation. Produces a plan artifact in glove-memory
 * resources and waits for user acceptance before proceeding.
 */

import type { ResourceFsAdapter } from "glove-memory";
import type { ModelAdapter, SubscriberAdapter } from "glove-core/core";
import type { OrchestratorEvent, Verdict } from "./types.ts";
import { PLAN_READY } from "./checkpoints.ts";
import { generatorBlueprint, evaluatorBlueprint } from "./blueprints.ts";
import { runGenEvalLoop } from "./gen-eval-loop.ts";
import type { ForwardingDisplayManager } from "./forwarding-display.ts";

export interface PlanResult {
  title: string;
  body: string;
  path: string;
  accepted: boolean;
}

export interface PlanPhaseDeps {
  model: ModelAdapter;
  contextLimit: number;
  emit: (event: OrchestratorEvent) => void;
  resources: ResourceFsAdapter;
  workspace: string;
  dataDir: string;
  meshDir: string;
  trackForwardedSlot: (slotId: string, dm: ForwardingDisplayManager) => void;
  createSubscriber?: () => SubscriberAdapter;
  signal?: AbortSignal;
}

/**
 * Run the plan phase: gather requirements, create a plan, wait for acceptance.
 *
 * Returns the plan result. If `accepted` is false, the caller should not
 * proceed to the build phase.
 */
export async function runPlanPhase(
  userPrompt: string,
  deps: PlanPhaseDeps,
): Promise<PlanResult> {
  const loopId = `plan_${Date.now().toString(36)}`;
  const suffix = Date.now().toString(36);

  const prompt = buildPlanPrompt(userPrompt);

  const verdict = await runGenEvalLoop(
    {
      loopId,
      generatorBlueprint: generatorBlueprint({ workspace: deps.workspace, idSuffix: suffix }),
      evaluatorBlueprint: evaluatorBlueprint({ workspace: deps.workspace, idSuffix: suffix }),
      checkpoints: [PLAN_READY],
      initialPrompt: prompt,
      maxRetries: 5,
      enrichArtifact: (text) => enrichWithPlan(text, deps.resources),
    },
    {
      model: deps.model,
      contextLimit: deps.contextLimit,
      emit: deps.emit,
      workspace: deps.workspace,
      dataDir: deps.dataDir,
      meshDir: deps.meshDir,
      resources: deps.resources,
      trackForwardedSlot: deps.trackForwardedSlot,
      createSubscriber: deps.createSubscriber,
      signal: deps.signal,
    },
  );

  if (verdict.action !== "proceed") {
    return {
      title: "Plan not completed",
      body: verdict.action === "terminate" ? verdict.reason : "Plan loop did not converge.",
      path: "/plans/current.md",
      accepted: false,
    };
  }

  const plan = await extractAndStorePlan(verdict, deps.resources);
  deps.emit({ type: "plan_created", path: plan.path, title: plan.title });
  deps.emit({ type: "plan_accepted", path: plan.path });
  return plan;
}

function buildPlanPrompt(userPrompt: string): string {
  return [
    "You are entering the PLAN PHASE. Your goal is to produce a complete,",
    "actionable plan for the following request:",
    "",
    userPrompt,
    "",
    "Steps:",
    "1. Ask the user clarifying questions to resolve ambiguities.",
    "2. Read the codebase to understand existing patterns and constraints.",
    "3. Draft a plan covering: scope, approach, sequencing, risks, verification.",
    "4. Write the plan using the glorp_update_plan tool.",
    "",
    "The plan will be evaluated for completeness before proceeding.",
    "Do not start implementation — only plan.",
  ].join("\n");
}

async function extractAndStorePlan(
  verdict: Verdict & { action: "proceed" },
  resources: ResourceFsAdapter,
): Promise<PlanResult> {
  const planPath = "/plans/current.md";
  const existing = await readPlanText(resources, planPath);
  if (existing) {
    const title = extractTitle(existing) ?? verdict.note ?? "Implementation Plan";
    return { title, body: existing, path: planPath, accepted: true };
  }
  const title = verdict.note ?? "Implementation Plan";
  const body = verdict.note ? `Plan approved.\n\n${verdict.note}` : "Plan approved by evaluator.";
  await resources.write(planPath, { type: "markdown", text: `# ${title}\n\n${body}` },
    { summary: title, tags: ["plan", "current"], links: [] },
    { source: "orchestrator:plan-phase", actor: "orchestrator", timestamp: new Date().toISOString(), note: "Fallback — generator did not write a plan document." },
  );
  return { title, body, path: planPath, accepted: true };
}

function extractTitle(md: string): string | null {
  const m = md.match(/^#\s+(.+)/m);
  return m ? m[1].trim() : null;
}

async function readPlanText(resources: ResourceFsAdapter, path: string): Promise<string | null> {
  try {
    const file = await resources.read(path, { range: [1, -1] });
    const text = file.body.type === "url" ? (file.body.cachedText ?? "") : file.body.text;
    return text || null;
  } catch { return null; }
}

/** Read the plan from the resource filesystem and append it to the generator's
 *  text artifact so the evaluator can judge the plan content, not just narration. */
async function enrichWithPlan(text: string, resources: ResourceFsAdapter): Promise<string> {
  const plan = await readPlanText(resources, "/plans/current.md");
  return plan ? `${text}\n\n---\n## Plan Document (from resources)\n${plan}` : text;
}
