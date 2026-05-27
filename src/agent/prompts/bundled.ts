/**
 * Bundled prompt files as strings. Uses readFileSync for Node.js subprocess
 * compatibility — Bun's `import ... with { type: "text" }` only works in
 * the Bun runtime, but orchestrator agents spawn node subprocesses.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(DIR, rel), "utf-8");

export const BUNDLED_PROMPTS: Record<string, string> = {
  "agents/main.md": read("agents/main.md"),
  "agents/planner.md": read("agents/planner.md"),
  "agents/researcher.md": read("agents/researcher.md"),
  "agents/reviewer.md": read("agents/reviewer.md"),
  "agents/generator.md": read("agents/generator.md"),
  "agents/evaluator.md": read("agents/evaluator.md"),
  "agents/builder.md": read("agents/builder.md"),
  "compaction.md": read("compaction.md"),
  "skill-instructions.md": read("skill-instructions.md"),
};
