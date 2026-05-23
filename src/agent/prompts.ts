import mainPrompt from "../prompts/main.md" with { type: "text" };
import plannerPrompt from "../prompts/planner.md" with { type: "text" };
import researcherPrompt from "../prompts/researcher.md" with { type: "text" };
import reviewerPrompt from "../prompts/reviewer.md" with { type: "text" };
import compactionPrompt from "../prompts/compaction.md" with { type: "text" };
import fleetResearchPrompt from "../prompts/fleet-research.md" with { type: "text" };

const RAW: Record<string, string> = {
  main: mainPrompt,
  planner: plannerPrompt,
  researcher: researcherPrompt,
  reviewer: reviewerPrompt,
  compaction: compactionPrompt,
  "fleet-research": fleetResearchPrompt,
};

export type PromptName = keyof typeof RAW;

/**
 * Load a system prompt by name. Markdown files in `src/prompts/` are bundled
 * at build time via Bun's text-import loader; this just resolves and
 * substitutes simple `{{token}}` placeholders so prompts stay declarative.
 */
export function loadPrompt(name: PromptName | string, vars: Record<string, string> = {}): string {
  const body = RAW[name];
  if (!body) throw new Error(`Unknown prompt: ${name}`);
  const date = new Date().toISOString().slice(0, 10);
  const ctx: Record<string, string> = { DATE: date, ...vars };
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => ctx[key] ?? match);
}

/** List the prompts shipped with the binary. */
export function listPrompts(): string[] {
  return Object.keys(RAW);
}
