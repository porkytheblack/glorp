import type { SubAgentDef } from "./types.ts";

export const reviewerDef: SubAgentDef = {
  name: "reviewer",
  description:
    "Use AFTER a substantial change to get a second opinion before declaring victory. " +
    "Pass: what was changed (files), what was the goal, where to look. Returns a numbered " +
    "punch-list and ends with 'verdict: ship' or 'verdict: needs work'.",
  tools: ["read", "grep", "glob"],
  promptName: "reviewer",
  maxTurns: 8,
  compactionInstruction: "Preserve findings; drop file-reading narration.",
};
