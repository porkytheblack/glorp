/**
 * Shared utilities for the gen-eval loop and its callers.
 * Extracted to keep gen-eval-loop.ts under the 200-line ceiling.
 */

import type { AgentBlueprint, LoopPhase, OrchestratorEvent } from "./types.ts";
import type { GlorpStore } from "../agent/store.ts";

/**
 * Extract the final text from a processRequest result.
 * The result shape varies depending on the model adapter.
 */
export function extractText(result: unknown): string {
  if (result && typeof result === "object" && "messages" in result) {
    const msgs = (result as { messages?: Array<{ text?: string }> }).messages ?? [];
    return msgs.at(-1)?.text ?? "(no output)";
  }
  return (result as { text?: string })?.text ?? "(no output)";
}

/** Build the prompt for a retry attempt, including evaluator feedback. */
export function buildRetryPrompt(
  original: string,
  feedback: string,
  attempt: number,
  max: number,
): string {
  return [
    `[Retry ${attempt}/${max}]`,
    "",
    "The evaluator requested revisions:",
    feedback,
    "",
    "Original task:",
    original,
    "",
    "Address the feedback above and produce an improved output.",
  ].join("\n");
}

/** Emit token/turn stats for an agent to the orchestrator event bus. */
export async function emitAgentStats(
  store: GlorpStore,
  bp: AgentBlueprint,
  phase: LoopPhase,
  emit: (event: OrchestratorEvent) => void,
): Promise<void> {
  const t = await store.getTokenCounts();
  emit({
    type: "agent_stats",
    agentId: bp.id,
    label: bp.label,
    role: bp.role,
    phase,
    turns: await store.getTurnCount(),
    tokensIn: t.in,
    tokensOut: t.out,
  });
}

/** Check if an error is an AbortError from signal cancellation. */
export function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

/**
 * Enrich a blueprint's system prompt with workspace context.
 * Returns a new blueprint — does not mutate the original.
 */
export function withWorkspaceContext(
  blueprint: AgentBlueprint,
  contextBlock: string,
): AgentBlueprint {
  if (!contextBlock) return blueprint;
  return {
    ...blueprint,
    systemPrompt: `${blueprint.systemPrompt}\n\n${contextBlock}`,
  };
}
