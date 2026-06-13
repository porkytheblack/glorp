import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { TaskSink } from "../task-sink.ts";

/**
 * The task toolkit — registered only when a session runs as a Garage task
 * (see the tool registry). They give the agent first-class verbs for the two
 * things a task worker does beyond the work itself: declare the finished
 * deliverable, and report progress on a long job. Questions to the requester
 * are already covered by the ask_* modal tools.
 *
 * Both write through the TaskSink (small JSON files in the session folder) that
 * the Garage Task API reads back — so the task's result is something the agent
 * DECLARES, not something we infer from its last message.
 */

export function deliverResultTool(sink: TaskSink): GloveFoldArgs<{
  summary: string;
  files?: string[];
  data?: Record<string, unknown>;
}> {
  return {
    name: "deliver_result",
    description:
      "Declare the finished deliverable for this task — the authoritative result the requester receives. " +
      "Call it when the work is done (and again after a follow-up change, which replaces the prior result). " +
      "`summary` is a short human-readable description of what you produced. List every deliverable file in " +
      "`files` (paths relative to the workspace, e.g. 'uploads/deck.pptx' or 'output/video.mp4' — they are " +
      "made available to the requester automatically). Use `data` for any structured result fields.",
    inputSchema: z.object({
      summary: z.string().min(1).describe("Short description of what was produced"),
      files: z.array(z.string()).optional().describe("Deliverable file paths, relative to the workspace"),
      data: z.record(z.string(), z.unknown()).optional().describe("Optional structured result fields"),
    }),
    async do(input) {
      const { files } = sink.deliver(input);
      const note = files.length
        ? `Delivered: ${input.summary} (${files.length} file${files.length === 1 ? "" : "s"}: ${files.join(", ")})`
        : `Delivered: ${input.summary}`;
      return { status: "success", data: note, renderData: { summary: input.summary, files } };
    },
  };
}

export function reportProgressTool(sink: TaskSink): GloveFoldArgs<{ message: string }> {
  return {
    name: "report_progress",
    description:
      "Post a short, non-blocking progress note for the requester to see while the task runs (e.g. " +
      "'bundling the composition', 'rendering frame 240/300'). Does not pause the task. The latest note wins. " +
      "Use it on long jobs so the requester can follow along; it is not a substitute for deliver_result.",
    inputSchema: z.object({
      message: z.string().min(1).describe("Short status note; the latest replaces the previous"),
    }),
    async do(input) {
      sink.progress(input.message);
      return { status: "success", data: `Progress: ${input.message}`, renderData: { message: input.message } };
    },
  };
}
