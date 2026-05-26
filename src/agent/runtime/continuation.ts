import type { Message } from "glove-core/core";
import type { IGloveRunnable } from "glove-core/glove";
import type { GlorpStore } from "../store.ts";
import { visibleMessageText } from "./model-guards.ts";
import { isAgentSender, isIntentOnlyText } from "./intent-detect.ts";

const CONTINUE_OPEN_TASKS_PROMPT = [
  "[internal task continuation]",
  "The current execution checklist still contains pending or in_progress tasks.",
  "Continue the work instead of summarizing.",
  "If a task is obsolete, reconcile the full list with glove_update_tasks.",
  "Do not claim completion until all applicable tasks are completed.",
].join("\n");

const INTENT_CONTINUATION_PROMPT = [
  "[internal continuation] Your completions have been narration only —",
  "stating what you will do without calling a tool.",
  "Call the next tool now. Do not describe the action; perform it.",
  "If a blocking inbox item is obsolete, first call glove_update_inbox.",
].join(" ");

export async function continueOpenTasks(args: {
  agent: IGloveRunnable;
  store: GlorpStore;
  signal?: AbortSignal;
  maxPasses?: number;
}): Promise<void> {
  const maxPasses = args.maxPasses ?? 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (args.signal?.aborted) return;
    const open = (await args.store.getTasks()).filter((task) => task.status !== "completed");
    if (open.length === 0) return;
    await args.agent.processRequest(CONTINUE_OPEN_TASKS_PROMPT, args.signal);
  }
}

/**
 * Store-level fallback for intent-only detection. After processRequest
 * completes, check whether the last agent message was just text saying
 * what it *will* do (no tool calls). This catches cases where the model
 * adapter's response format doesn't match what the model-level guard
 * expects (e.g. custom adapters that set sender="assistant" instead of
 * "agent", or adapters that structure messages differently).
 */
export async function continueIfIntentOnly(args: {
  agent: IGloveRunnable;
  store: GlorpStore;
  signal?: AbortSignal;
  maxPasses?: number;
}): Promise<void> {
  const maxPasses = args.maxPasses ?? 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (args.signal?.aborted) return;
    const messages = await args.store.getDisplayMessages();
    if (!lastAgentTurnIsIntentOnly(messages)) return;
    await args.agent.processRequest(INTENT_CONTINUATION_PROMPT, args.signal);
  }
}

function lastAgentTurnIsIntentOnly(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.is_compaction || m.is_compaction_request || m.is_skill_injection) continue;
    if ((m.tool_results?.length ?? 0) > 0) return false;
    if ((m.tool_calls?.length ?? 0) > 0) return false;
    if (isAgentSender(m.sender)) {
      const text = visibleMessageText(m).trim();
      return text.length > 0 && isIntentOnlyText(text);
    }
    if (m.sender === "user") return false;
  }
  return false;
}
