import type { SubAgentDef } from "./types.ts";

export const researcherDef: SubAgentDef = {
  name: "researcher",
  description:
    "Use for investigative tasks: 'find every place that calls X', 'how is config wired', " +
    "'what does this library expose'. Returns a tight summary with file:line citations. " +
    "Pass a single specific question; consume the tight summary it returns.",
  tools: ["read", "grep", "glob", "ls", "web_fetch"],
  promptName: "researcher",
  maxTurns: 12,
  compactionInstruction: "Preserve findings and citations; drop search-step chatter.",
};
