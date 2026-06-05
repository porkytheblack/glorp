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

// Documents have no toolchain "test". The validation move is to re-open the
// artifact and judge it against concrete criteria, then run a declared
// validator or an independent reviewer. This is the article's generator/
// evaluator split applied to deliverables.
const VERIFY_DOC_PROMPT = [
  "[internal verification enforcement]",
  "You are about to declare a document/artifact deliverable complete, but you",
  "have not validated it since the last edit. Generating a file is not the same",
  "as confirming it is good. Before claiming completion, do a real validation pass:",
  "",
  "1. Re-open the artifact you produced (read it back) and judge it against",
  "   concrete criteria: does it fully answer the request, is the structure",
  "   coherent, are sections complete (no placeholders/TODOs/lorem), is the",
  "   formatting clean, are facts/numbers internally consistent?",
  "2. If the skill declares a validator (e.g. `scripts/office/validate.py`), run it.",
  "3. For a substantial deliverable, hand it to an independent pass with",
  "   `glove_invoke_subagent({ name: \"reviewer\" })` (or spawn an `evaluator`) —",
  "   a separate judge catches what self-review misses.",
  "4. Fix every issue found, then re-check.",
  "",
  "Only declare completion after the artifact passes that pass. If validation",
  "genuinely cannot run here, say so explicitly and name what would be needed.",
].join("\n");

function pickVerifyPrompt(pending: string[], docs: string[], hasFailed: boolean): string {
  // Failed toolchain runs are always code-shaped — keep the code prompt.
  if (hasFailed) return VERIFY_FIRST_PROMPT;
  // Only switch to the document prompt when every pending file is a document;
  // any pending source file means real code verification still rules.
  if (pending.length > 0 && docs.length === pending.length) return VERIFY_DOC_PROMPT;
  return VERIFY_FIRST_PROMPT;
}

/** Keywords/phrases that signal the agent believes work is done. */
const COMPLETION_SIGNALS = [
  /\b(?:all|everything|the work|implementation|task|changes?|document|deliverable|report|file|artifact|deck|presentation|draft)\s+(?:is|are)\s+(?:complete|done|finished|ready)\b/i,
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

      // Agent claims completion but hasn't verified — force verification,
      // using document-shaped guidance when the pending work is all documents.
      const prompt = pickVerifyPrompt(status.pendingFiles, status.pendingDocs ?? [], hasFailed);
      return model.prompt({
        ...request,
        messages: [
          ...request.messages,
          ...result.messages,
          { sender: "user", text: prompt, is_skill_injection: true } as Message,
        ],
      }, notify, signal);
    },
  };
}
