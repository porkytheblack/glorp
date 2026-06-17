/**
 * Agent assembly: builds the main Glove runnable from session state.
 * Extracted from glorp.ts to respect the 200-line file ceiling.
 */

import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import type { PickedModel } from "../model-picker.ts";
import type { GlorpStore } from "../store.ts";
import { buildGlorpSystemPrompt, taskWorkerPreamble, COMPACTION_INSTRUCTIONS } from "../persona.ts";
import { MAIN_AGENT_TOOLS, TASK_TOOLS, createToolRegistry, registerTools } from "../tools/registry.ts";
import type { TaskSink } from "../task-sink.ts";
import type { TaskContext } from "../task-deliverable.ts";
import { plannerSubAgent, researcherSubAgent, reviewerSubAgent } from "../subagents.ts";
import { makeDiskSubAgent } from "../agents/disk-subagent.ts";
import { getBridge } from "../../shared/bridge.ts";
import { Orchestrator } from "../../orchestrator/orchestrator.ts";
import { mountAgentMesh, teardownAgentMesh, type FileMeshAdapter } from "../../orchestrator/mesh-setup.ts";
import type { ExtensionsBundle } from "../extensions-loader.ts";
import { createGlorpSubscriber } from "./subscriber.ts";
import { foldContextTools } from "./glove-tools.ts";
import { foldResourceTools, createSessionResources } from "./resources.ts";
import { registerHooks } from "./hooks.ts";
import { registerBuiltInSkills, registerDiskSkills } from "./skills.ts";
import { createRefreshers } from "./refresh.ts";
import { wrapGlorpModel } from "./model-guards.ts";
import { withVerificationEnforcement } from "./verification-guard.ts";
import { VerificationTracker } from "./verification-tracker.ts";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { IGloveRunnable } from "glove-core/glove";
import type { Context } from "glove-core/core";

export interface AssembleArgs {
  picked: PickedModel;
  contextLimit: number;
  workspace: string;
  dataDir: string;
  meshDir: string;
  store: GlorpStore;
  resources: ReturnType<typeof createSessionResources>;
  orchestrator: Orchestrator;
  bridge: ReturnType<typeof getBridge>;
  /** The display manager to use — may already be wrapped (e.g. PermissionDM). */
  displayManager: DisplayManagerAdapter;
  diskExtensions: ExtensionsBundle;
  refresh: ReturnType<typeof createRefreshers>;
  ctxRef: { current: Context | null };
  inboxContext: Context;
  verification: VerificationTracker;
  /** Override the system prompt (e.g. a non-default agent persona). */
  systemPrompt?: string;
  /** Mesh identity name for this agent (defaults to "main"). */
  meshName?: string;
  /** Per-session env injected into bash spawns (e.g. GLORP_SESSION_ID). */
  sessionEnv?: Record<string, string>;
  /** Task context (present only in task mode) — drives the worker preamble + toolkit. */
  task?: TaskContext;
  /** Backs deliver_result / report_progress; present iff `task` is. */
  taskSink?: TaskSink;
}

export interface AssembleResult {
  agent: IGloveRunnable;
  meshAdapter: FileMeshAdapter;
}

export async function assembleAgent(args: AssembleArgs): Promise<AssembleResult> {
  const model = withVerificationEnforcement(wrapGlorpModel(args.picked.adapter), args.verification);
  const builder = new Glove({
    store: args.store,
    model,
    displayManager: args.displayManager,
    serverMode: true,
    systemPrompt: composeSystemPrompt(args),
    compaction_config: {
      compaction_instructions: COMPACTION_INSTRUCTIONS,
      compaction_context_limit: args.contextLimit,
      max_turns: 200,
    },
  });

  builder.addSubscriber(createGlorpSubscriber(args.bridge, args.refresh, args.verification));
  registerTools(
    builder,
    createToolRegistry({
      workspace: args.workspace,
      sessionEnv: args.sessionEnv,
      dataDir: args.dataDir,
      store: args.store,
      resources: args.resources,
      orchestrator: args.orchestrator,
      contextRef: args.ctxRef,
      meshDir: args.meshDir,
      bridge: args.bridge,
      taskSink: args.taskSink,
    }),
    args.taskSink ? [...MAIN_AGENT_TOOLS, ...TASK_TOOLS] : MAIN_AGENT_TOOLS,
  );
  foldResourceTools(builder, args.resources);
  builder
    .defineSubAgent(plannerSubAgent({ workspace: args.workspace, dataDir: args.dataDir }))
    .defineSubAgent(researcherSubAgent({ workspace: args.workspace, dataDir: args.dataDir }))
    .defineSubAgent(reviewerSubAgent({ workspace: args.workspace, dataDir: args.dataDir }));
  for (const sub of args.diskExtensions.subagents) {
    builder.defineSubAgent(makeDiskSubAgent(sub, { workspace: args.workspace, dataDir: args.dataDir }));
  }
  registerHooks(builder);
  registerDiskSkills(builder, args.diskExtensions.skills);
  registerBuiltInSkills(builder, args.diskExtensions.skills);

  const agent = builder.build();
  (agent as any).promptMachine.enableToolResultSummary = true;
  foldContextTools(agent, args.inboxContext);

  const caps = ["orchestrate", "plan", "interact", "generate"];
  const meshAdapter = await mountAgentMesh(agent, args.meshName ?? "main", args.meshDir, caps);
  return { agent, meshAdapter };
}

/** Base persona, prefixed with the task-worker preamble when in task mode. */
function composeSystemPrompt(args: AssembleArgs): string {
  const base = args.systemPrompt ?? buildGlorpSystemPrompt({
    workspace: args.workspace,
    contextLimit: args.contextLimit,
    extensions: args.diskExtensions,
  });
  return args.task ? `${taskWorkerPreamble(args.task.type, args.task.deliverable)}\n\n${base}` : base;
}

export function wireOrchestratorToBridge(
  orch: Orchestrator,
  bridge: ReturnType<typeof getBridge>,
): void {
  orch.subscribe((event) => {
    switch (event.type) {
      case "agent_spawned":
        bridge.emit({
          type: "orchestrator_agent",
          agent: {
            id: event.agent.id,
            label: event.agent.label,
            action: "spawned",
            role: event.agent.role,
            slot: event.agent.slot,
          },
        });
        break;
      case "agent_stopped":
        bridge.emit({
          type: "orchestrator_agent",
          agent: { id: event.id, label: event.id, action: "stopped" },
        });
        break;
      case "loop_phase":
        bridge.emit({ type: "orchestrator_phase", loopId: event.loopId, phase: event.phase });
        break;
      case "verdict": {
        const detail = "note" in event.verdict
          ? event.verdict.note
          : "feedback" in event.verdict
            ? event.verdict.feedback
            : "reason" in event.verdict
              ? event.verdict.reason
              : undefined;
        bridge.emit({
          type: "orchestrator_verdict",
          loopId: event.loopId,
          checkpoint: event.checkpoint,
          action: event.verdict.action,
          detail,
        });
        break;
      }
      case "slot_forwarded":
        bridge.emit({
          type: "display_slot_pushed",
          slot: {
            slotId: event.slotId,
            renderer: event.renderer,
            input: event.input,
            createdAt: Date.now(),
            isPermissionRequest: event.renderer === "permission_request",
          },
        });
        break;
      case "plan_created":
        bridge.emit({ type: "orchestrator_plan", action: "created", path: event.path, title: event.title });
        break;
      case "plan_accepted":
        bridge.emit({ type: "orchestrator_plan", action: "accepted", path: event.path });
        break;
      case "slot_switched":
        bridge.emit({ type: "orchestrator_slot", promoted: event.promoted, demoted: event.demoted });
        break;
      case "agent_stats":
        bridge.emit({ type: "runner_agent_stats", agent: { agentId: event.agentId, label: event.label, role: event.role, phase: event.phase, turns: event.turns, tokensIn: event.tokensIn, tokensOut: event.tokensOut } });
        break;
      case "error":
        bridge.emit({ type: "error", message: event.message, detail: event.detail });
        break;
    }
  });
}
