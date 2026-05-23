import type { SubAgentDef } from "./types.ts";

export const plannerDef: SubAgentDef = {
  name: "planner",
  description:
    "Use for 'design me an approach' tasks. The planner thinks through the problem and " +
    "returns a step-by-step plan WITHOUT writing code. Pass the full requirement and " +
    "relevant constraints in the prompt; consume the returned plan to drive your work.",
  tools: ["read", "grep", "glob", "ls"],
  promptName: "planner",
  maxTurns: 6,
  compactionInstruction: "Preserve the plan and any open questions.",
};
