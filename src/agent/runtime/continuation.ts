import type { IGloveRunnable } from "glove-core/glove";
import type { GlorpStore } from "../store.ts";

const CONTINUE_OPEN_TASKS_PROMPT = [
  "[internal task continuation]",
  "The current execution checklist still contains pending or in_progress tasks.",
  "Continue the work instead of summarizing.",
  "If a task is obsolete, reconcile the full list with glove_update_tasks.",
  "Do not claim completion until all applicable tasks are completed.",
].join("\n");

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
