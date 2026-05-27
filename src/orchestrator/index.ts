/**
 * Public API surface for the orchestrator module.
 */

export { Orchestrator } from "./orchestrator.ts";
export { OrchestratorEventBus } from "./events.ts";
export { Scheduler, type PromotionRequest } from "./scheduler.ts";
export { NoopDisplayManager } from "./noop-display.ts";
export { ForwardingDisplayManager, type ForwardedSlot, type SlotForwardCallback } from "./forwarding-display.ts";
export { FileMeshAdapter, mountAgentMesh, teardownAgentMesh } from "./mesh-setup.ts";
export { runGenEvalLoop } from "./gen-eval-loop.ts";
export { extractText, buildRetryPrompt, emitAgentStats, isAbort, withWorkspaceContext } from "./loop-utils.ts";
export { runPlanPhase, type PlanResult } from "./plan-phase.ts";
export { spawnAgentTool } from "./spawn-tool.ts";
export { createOrchestratorRunner, type RunnerHandle } from "./runner.ts";
export {
  defineOrchestratorAgent,
  blueprintToInput,
  buildAgentFromBlueprint,
  AgentInput,
  type BuiltAgent,
} from "./agent-factory.ts";
export {
  generatorBlueprint,
  evaluatorBlueprint,
  researchBlueprint,
  builderBlueprint,
  plannerBlueprint,
  reviewerBlueprint,
  blueprintForSpawn,
} from "./blueprints.ts";
export {
  ROLE_DEFS,
  roleDef,
  rolePrompt,
  type RoleDef,
} from "./role-registry.ts";
export {
  PLAN_READY,
  FEATURE_COMPLETE,
  ITERATION_DONE,
  IMPLEMENTATION_COMPLETE,
  VERIFICATION_PASSED,
  makeCheckpoint,
  formatCriteriaBlock,
  parseVerdict,
} from "./checkpoints.ts";
export { discoverWorkspaceContext, formatContextForPrompt, type WorkspaceContext } from "./workspace-context.ts";
export {
  runVerification,
  defaultVerificationCommands,
  type VerificationCommand,
  type VerificationReport,
  type VerificationResult,
} from "./verification.ts";
export {
  parseFailures,
  formatFailureSummary,
  type ParsedFailure,
} from "./failure-parser.ts";
export {
  type AgentId,
  type AgentBlueprint,
  type AgentSlot,
  type Checkpoint,
  type GenEvalLoopOptions,
  type LoopPhase,
  type LoopRole,
  type ManagedAgent,
  type OrchestratorConfig,
  type OrchestratorEvent,
  type OrchestratorListener,
  type Slot,
  type Verdict,
  agentId,
} from "./types.ts";
