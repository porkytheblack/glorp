import { z } from "zod";
import type { GloveFoldArgs, Context } from "glove-core";
import type { GlorpFleet } from "../station-bridge.ts";

/**
 * Lets Glorp fan out a batch of small jobs onto the Station fleet
 * (running in-process). Each job posts its result back to Glorp's inbox
 * under a shared tag so the agent can pick the results up on its next
 * turn. Useful for: independent file edits, parallel research questions,
 * batched-bash-like fan-out.
 */
export function fleetDispatchTool(
  fleet: GlorpFleet,
  contextRef: { current: Context | null },
): GloveFoldArgs<{
  kind: "research" | "edit-fanout" | "shell-fanout";
  jobs: Array<{ name?: string; payload: string }>;
  blocking?: boolean;
}> {
  return {
    name: "dispatch_fleet",
    description:
      "Fan out independent jobs onto the Station background fleet. Each job runs in parallel " +
      "and posts its result back to your inbox under tag `fleet:<kind>:<batch>`. " +
      "Pick `kind`: 'research' (look up something + summarise), 'edit-fanout' (apply same shell " +
      "command across many targets), or 'shell-fanout' (run an arbitrary shell snippet). " +
      "Use this when 3+ jobs are independent and serial execution would be wasteful. " +
      "Set blocking=true to mark the inbox items as blocking — you should wait for them.",
    inputSchema: z.object({
      kind: z
        .enum(["research", "edit-fanout", "shell-fanout"])
        .describe("Job kind — picks which Station signal to fire"),
      jobs: z
        .array(
          z.object({
            name: z.string().optional().describe("Short label for this job"),
            payload: z.string().describe("The job-specific instruction or command"),
          }),
        )
        .min(1)
        .max(20)
        .describe("Jobs to dispatch in parallel"),
      blocking: z
        .boolean()
        .optional()
        .describe("Mark inbox replies as blocking — Glorp should wait for them (default false)"),
    }),
    async do(input) {
      const ctx = contextRef.current;
      if (!ctx) {
        return {
          status: "error",
          data: null,
          message: "Inbox not available — Glorp is offline from its mailbox right now.",
        };
      }
      const batchId = `b${Date.now().toString(36)}`;
      const tag = `fleet:${input.kind}:${batchId}`;
      const dispatchedIds: string[] = [];
      for (const [i, job] of input.jobs.entries()) {
        const itemId = `${tag}:${i}`;
        await ctx.addInboxItem({
          id: itemId,
          tag,
          request: job.name ? `${job.name}: ${job.payload}` : job.payload,
          response: null,
          status: "pending",
          blocking: input.blocking ?? false,
          created_at: new Date().toISOString(),
          resolved_at: null,
        });
        dispatchedIds.push(itemId);
        // Fire-and-forget — station signals trigger via .trigger(), which
        // returns immediately with a run id. The signal handler resolves
        // the inbox item when it completes.
        await fleet.dispatch(input.kind, {
          itemId,
          tag,
          payload: job.payload,
          name: job.name,
        });
      }
      return {
        status: "success",
        data: `Dispatched ${input.jobs.length} job${
          input.jobs.length === 1 ? "" : "s"
        } to the ${input.kind} fleet under tag ${tag}. Results will land in your inbox on the next turn.`,
        renderData: { tag, count: input.jobs.length, jobs: input.jobs, blocking: !!input.blocking },
      };
    },
  };
}
