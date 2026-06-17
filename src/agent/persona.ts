import { GLORP_VERSION, GLORP_CODENAME } from "../shared/version.ts";
import { describeDeliverable, type DeliverableContract } from "./task-deliverable.ts";
import type { ExtensionsBundle } from "./extensions-loader.ts";
import { readPrompt } from "./prompts/loader.ts";
import { buildProjectInstructionsContext } from "./project-instructions.ts";
import { xmlSection } from "./prompts/synthetic.ts";
import { buildExtensionsContext } from "./skills-context.ts";

export interface SystemPromptOptions {
  workspace: string;
  contextLimit: number;
  extensions: ExtensionsBundle;
}

export function buildGlorpSystemPrompt(opts: SystemPromptOptions): string {
  return [
    readPrompt("agents/main.md", { DATE: new Date().toISOString().slice(0, 10) }),
    runtimeContext(opts.workspace),
    buildProjectInstructionsContext({
      workspace: opts.workspace,
      contextLimit: opts.contextLimit,
    }),
    buildExtensionsContext(opts.extensions, { contextLimit: opts.contextLimit }),
  ].filter(Boolean).join("\n\n");
}

export function builtInAgentPrompt(
  name: "planner" | "researcher" | "reviewer" | "generator" | "evaluator" | "builder",
): string {
  return readPrompt(`agents/${name}.md`);
}

const ROLE_PROMPT_NAMES = new Set(["planner", "researcher", "reviewer", "generator", "evaluator", "builder"]);

/**
 * System prompt for a conversational agent of a given role. The default
 * ("general"/"main") agent is the full glorp persona; other roles layer their
 * built-in role prompt over the same runtime + project + extensions context.
 */
export function buildAgentSystemPrompt(role: string, opts: SystemPromptOptions): string {
  if (role === "general" || role === "main" || !ROLE_PROMPT_NAMES.has(role)) {
    return buildGlorpSystemPrompt(opts);
  }
  return [
    builtInAgentPrompt(role as Parameters<typeof builtInAgentPrompt>[0]),
    runtimeContext(opts.workspace),
    buildProjectInstructionsContext({ workspace: opts.workspace, contextLimit: opts.contextLimit }),
    buildExtensionsContext(opts.extensions, { contextLimit: opts.contextLimit }),
  ].filter(Boolean).join("\n\n");
}

export const COMPACTION_INSTRUCTIONS = readPrompt("compaction.md");

/**
 * Prefix injected into a task-mode worker's system prompt. Tells the agent it
 * is fulfilling a discrete task and how to use the task toolkit — deliver the
 * result explicitly, report progress on long jobs, and pause for the requester
 * with the ask_* tools when a decision is genuinely needed.
 */
export function taskWorkerPreamble(taskType: string, deliverable?: DeliverableContract | null): string {
  const lines = [
    `# You are a Glorp Garage task worker`,
    `You are running autonomously inside Glorp Garage, fulfilling a single task of type "${taskType}". A requester submitted it and is waiting for the result — they are not watching you work, so do not ask for confirmation you don't truly need.`,
    `The requester may have attached input files in ./inputs — that is their read-only input area. Before you start, list ./inputs and consult anything the prompt refers to (a brief, data, an asset, "the attached file"); resolve a bare filename there first. Treat ./inputs as inputs only — never put deliverables there.`,
    `When the work is done, call **deliver_result** with a short summary and the paths of every deliverable file (place files in ./uploads or ./output — they are made available to the requester automatically). Calling it again after a follow-up change replaces the previous result.`,
    `Before you deliver, VERIFY the work — never ship a file unseen. For a deck/document, render its pages to images (export a PDF via LibreOffice, then \`pdftoppm -png\`) and **view_image** each one; for a video, \`ffprobe\` it and **view_image** a few sampled frames; for an image, **view_image** it directly. Confirm: no text overflowing or clipped off the page, no empty/placeholder-looking sections, consistent layout, and content that matches the request. Fix any real defects and re-check — cap it at two passes, then deliver.`,
  ];
  if (deliverable) {
    const expected = describeDeliverable(deliverable);
    lines.push(
      `**Required deliverable:** this task must produce ${expected}. deliver_result will REJECT your call — and the task will NOT complete — if a declared file is missing, the wrong type, or fails verification. Keep working until deliver_result returns success; a rejection tells you exactly what to fix.`,
      `**Never deliver an intermediate as the final result.** A JSON storyboard, spec, plan, manifest, or a written description of the work is a work product, not a deliverable. Do not hand one back in place of ${expected}. If you have only produced an intermediate representation, you are not done — render it into the real artifact and deliver that (unless the task explicitly asks for the intermediate format).`,
    );
  }
  lines.push(
    `On long jobs, call **report_progress** with a brief note so the requester can follow along; it never pauses you.`,
    `If — and only if — you need a decision or information that you cannot reasonably infer, use **ask_choice** / **ask_text** / **ask_confirm**. These pause the task until the requester answers, so reserve them for genuine forks. Otherwise work to completion on your own.`,
    `Your task id and type are in the environment (GLORP_TASK_ID, GLORP_TASK_TYPE); GLORP_GARAGE=1 marks this runtime.`,
  );
  return lines.join("\n\n");
}

function runtimeContext(workspace: string): string {
  return xmlSection("glorp_runtime", {}, [
    `version: ${GLORP_VERSION} (${GLORP_CODENAME})`,
    `workspace: ${workspace}`,
  ].join("\n"));
}
