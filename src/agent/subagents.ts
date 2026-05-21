import { Glove } from "glove-core/glove";
import type { DefineSubAgentArgs } from "glove-core/extensions";
import { MemoryStore } from "./memory-store-shim.ts";
import { readTool } from "./tools/read.ts";
import { grepTool } from "./tools/grep.ts";
import { globTool } from "./tools/glob.ts";
import { lsTool } from "./tools/ls.ts";
import { webFetchTool } from "./tools/webfetch.ts";

interface SubAgentDeps {
  workspace: string;
}

export function plannerSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return {
    name: "planner",
    description:
      "Use for 'design me an approach' tasks. The planner thinks through the problem and returns a step-by-step plan WITHOUT writing code. Pass the full requirement + relevant constraints in the prompt.",
    factory: async ({ parentStore, parentControls }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.("planner", false)) ??
        new MemoryStore(`planner_${Date.now()}`);
      return new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt:
          "You are Glorp's planning subagent. The friend-shape needs an APPROACH, not code. " +
          "Read the prompt, ask yourself: 'what's the simplest design that solves this'. " +
          "Return: (1) one-paragraph summary of the approach, (2) 3-8 concrete steps in order, " +
          "(3) any open questions or risks. No code. Be terse.",
        compaction_config: {
          compaction_instructions: "Preserve the plan and any open questions.",
          max_turns: 6,
        },
      })
        .fold(readTool(deps.workspace))
        .fold(grepTool(deps.workspace))
        .fold(globTool(deps.workspace))
        .fold(lsTool(deps.workspace))
        .build();
    },
  };
}

export function researcherSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return {
    name: "researcher",
    description:
      "Use for investigative tasks: 'find every place that calls X', 'how is config wired', 'what does this library expose'. Returns a tight summary with file:line citations. Prompt should be a single specific question.",
    factory: async ({ parentStore, parentControls }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.("researcher", false)) ??
        new MemoryStore(`researcher_${Date.now()}`);
      return new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt:
          "You are Glorp's research subagent. Investigate using read/grep/glob/ls/web_fetch. " +
          "Be exhaustive about searching but compact about reporting. Return: " +
          "(1) the direct answer, (2) supporting file:line citations, (3) any caveats. " +
          "No code unless directly quoting. Be terse.",
        compaction_config: {
          compaction_instructions: "Preserve findings and citations; drop search-step chatter.",
          max_turns: 12,
        },
      })
        .fold(readTool(deps.workspace))
        .fold(grepTool(deps.workspace))
        .fold(globTool(deps.workspace))
        .fold(lsTool(deps.workspace))
        .fold(webFetchTool)
        .build();
    },
  };
}

export function reviewerSubAgent(deps: SubAgentDeps): DefineSubAgentArgs {
  return {
    name: "reviewer",
    description:
      "Use AFTER a substantial change to get a second opinion before declaring victory. Pass: what was changed (files), what was the goal, and where to look. Returns: a punch-list of issues + 'looks good' / 'needs work'.",
    factory: async ({ parentStore, parentControls }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.("reviewer", false)) ??
        new MemoryStore(`reviewer_${Date.now()}`);
      return new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt:
          "You are Glorp's reviewer subagent. Read the changed files (use read/grep). " +
          "Check for: (a) does it solve the stated goal, (b) obvious bugs / off-by-ones, " +
          "(c) error handling at boundaries, (d) inconsistency with surrounding code, " +
          "(e) untested edges. Return a numbered punch-list. End with 'verdict: ship' or " +
          "'verdict: needs work'. Be direct, no fluff.",
        compaction_config: {
          compaction_instructions: "Preserve findings; drop file-reading narration.",
          max_turns: 8,
        },
      })
        .fold(readTool(deps.workspace))
        .fold(grepTool(deps.workspace))
        .fold(globTool(deps.workspace))
        .build();
    },
  };
}
