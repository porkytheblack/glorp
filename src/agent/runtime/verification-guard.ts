/**
 * Model guard that prevents the agent from declaring work complete when
 * there are unverified file mutations or failed verifications. This is
 * the enforcement half of the verification tracker — the tracker observes,
 * this guard acts.
 *
 * Inserted into the model guard chain in assemble.ts so the agent is
 * forced to run verification before any completion claim is accepted.
 */

import type { Message, ModelAdapter, SubscriberAdapter } from "glove-core/core";
import type { VerificationTracker } from "./verification-tracker.ts";
import { modelResultHasToolCall, visibleMessageText } from "./model-guards.ts";
import { isAgentSender } from "./intent-detect.ts";

const VERIFY_FIRST_PROMPT = [
  "[internal verification enforcement]",
  "You are about to declare the work complete, but there are unverified",
  "file mutations or recent failed verifications. Before claiming completion:",
  "",
  "1. Run the typecheck command (e.g. `tsc --noEmit` or equivalent)",
  "2. Run the test suite (e.g. `bun test` or equivalent)",
  "3. Run the linter if configured",
  "",
  "Only declare completion after all verification commands pass.",
  "If a verification fails, fix the issue and re-run.",
  "If verification genuinely cannot run, explain why explicitly.",
].join("\n");

/** Keywords/phrases that signal the agent believes work is done. */
const COMPLETION_SIGNALS = [
  /\b(?:all|everything|the work|implementation|task|changes?)\s+(?:is|are)\s+(?:complete|done|finished|ready)\b/i,
  /\bi(?:'ve| have)\s+(?:completed|finished|done|implemented)\b/i,
  /\bthat(?:'s| is)\s+(?:all|everything|it)\b.*(?:done|complete|ready|finished)/i,
  /\bwork is (?:now )?done\b/i,
  /\bsuccessfully (?:completed|implemented|built|created|added)\b/i,
  /\bshould now (?:be )?(?:working|complete|ready|passing)\b/i,
  /\ball (?:tests?|checks?|verifications?) (?:pass|passing|passed|succeed)\b/i,
];

function looksLikeCompletion(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || !isAgentSender(m.sender)) continue;
    if ((m.tool_calls?.length ?? 0) > 0) return false;
    const text = visibleMessageText(m).trim();
    if (!text) continue;
    return COMPLETION_SIGNALS.some((p) => p.test(text));
  }
  return false;
}

/**
 * Wrap a model adapter with verification enforcement.
 * When the model produces a completion-like response but the verification
 * tracker shows unverified mutations or failed verifications, inject a
 * continuation prompt forcing the agent to verify first.
 */
export function withVerificationEnforcement(
  model: ModelAdapter,
  tracker: VerificationTracker,
): ModelAdapter {
  return {
    get name() { return model.name; },
    setSystemPrompt(sp: string) { model.setSystemPrompt(sp); },
    async prompt(request, notify, signal) {
      const result = await model.prompt(request, notify, signal);
      if (signal?.aborted) return result;
      if (modelResultHasToolCall(result)) return result;

      const status = tracker.status();
      const hasPending = status.pendingFiles.length > 0;
      const hasFailed = (status.failedVerifications ?? []).length > 0;
      if (!hasPending && !hasFailed) return result;

      if (!looksLikeCompletion(result.messages)) return result;

      // Agent claims completion but hasn't verified — force verification
      return model.prompt({
        ...request,
        messages: [
          ...request.messages,
          ...result.messages,
          { sender: "user", text: VERIFY_FIRST_PROMPT, is_skill_injection: true } as Message,
        ],
      }, notify, signal);
    },
  };
}
