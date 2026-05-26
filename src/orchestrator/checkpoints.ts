/**
 * Checkpoint definitions for generate-evaluate loops.
 * A checkpoint is a named gate with evaluation criteria.
 */

import type { Checkpoint, Verdict } from "./types.ts";

/** Built-in checkpoint for the plan phase: all user questions answered. */
export const PLAN_READY: Checkpoint = {
  name: "plan_ready",
  description: "The plan is complete, all ambiguities resolved, user has accepted.",
  criteria: [
    "All clarifying questions answered by the user",
    "Scope is explicit — no open-ended assumptions",
    "Approach documented with risks and verification steps",
    "User has explicitly accepted the plan",
  ],
};

/** Built-in checkpoint for feature completion: evaluator satisfied. */
export const FEATURE_COMPLETE: Checkpoint = {
  name: "feature_complete",
  description: "The feature implementation satisfies the plan's acceptance criteria.",
  criteria: [
    "All plan tasks addressed",
    "Code compiles / passes lint",
    "Core functionality verified against acceptance criteria",
    "No placeholder or incomplete implementations",
  ],
};

/** Built-in checkpoint for iteration: single gen-eval pass done. */
export const ITERATION_DONE: Checkpoint = {
  name: "iteration_done",
  description: "One generate-evaluate pass is complete; decide next step.",
  criteria: [
    "Generator produced a concrete artifact or action",
    "Output is coherent and addresses the current objective",
  ],
};

export function makeCheckpoint(
  name: string,
  description: string,
  criteria: string[],
): Checkpoint {
  return { name, description, criteria };
}

/**
 * Format a checkpoint's criteria into a string block the evaluator
 * agent can reason over inside its system prompt.
 */
export function formatCriteriaBlock(checkpoint: Checkpoint): string {
  const bullets = checkpoint.criteria.map((c) => `  - ${c}`).join("\n");
  return [
    `## Checkpoint: ${checkpoint.name}`,
    checkpoint.description,
    "",
    "Criteria:",
    bullets,
  ].join("\n");
}

/**
 * Parse the evaluator's structured response into a Verdict.
 * Expects JSON with `{ action, feedback?, reason?, note? }`.
 */
export function parseVerdict(raw: string): Verdict {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return inferVerdictFromText(trimmed);
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const action = String(parsed.action ?? "").toLowerCase();
    if (action === "proceed") {
      return { action: "proceed", note: optString(parsed.note) };
    }
    if (action === "retry") {
      return {
        action: "retry",
        feedback: optString(parsed.feedback) ?? "No specific feedback provided.",
        maxRetries: typeof parsed.maxRetries === "number" ? parsed.maxRetries : undefined,
      };
    }
    if (action === "terminate") {
      return {
        action: "terminate",
        reason: optString(parsed.reason) ?? "Evaluator terminated the loop.",
      };
    }
    return inferVerdictFromText(trimmed);
  } catch {
    return inferVerdictFromText(trimmed);
  }
}

function inferVerdictFromText(text: string): Verdict {
  const lower = text.toLowerCase();
  if (lower.includes("proceed") || lower.includes("approved") || lower.includes("accepted")) {
    return { action: "proceed", note: text.slice(0, 200) };
  }
  if (lower.includes("terminate") || lower.includes("reject") || lower.includes("abort")) {
    return { action: "terminate", reason: text.slice(0, 500) };
  }
  return { action: "retry", feedback: text.slice(0, 500) };
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
