import { MemorySchema } from "glove-memory";

export const GLORP_RESOURCE_ROOTS = [
  {
    path: "/plans",
    description:
      "Durable methodology plans. /plans/current.md mirrors the active plan document.",
  },
  {
    path: "/tasks",
    description:
      "Execution task artifacts and snapshots derived from a plan, kept separate from plan prose.",
    semanticSearch: false,
  },
  {
    path: "/notes",
    description: "Session notes, decisions, assumptions, and reusable working memory.",
  },
  {
    path: "/research",
    description: "Research captures, references, excerpts, and investigation summaries.",
  },
  {
    path: "/artifacts",
    description: "Generated artifacts, status reports, handoff notes, and summaries.",
  },
  {
    path: "/subagents",
    description:
      "Subagent outputs and handoffs, linked to the triggering message or parent task where possible.",
  },
] as const;

export function createGlorpMemorySchema(): MemorySchema {
  const schema = new MemorySchema();
  for (const root of GLORP_RESOURCE_ROOTS) schema.defineResourceRoot(root);
  return schema;
}
