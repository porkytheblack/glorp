/**
 * Single source of truth for agent role definitions.
 * Every consumer — blueprints, subagents, continuum factory — reads from here.
 * To add a role: add its prompt file, register it in bundled.ts, add an entry below.
 */

import { readPrompt } from "../agent/prompts/loader.ts";

export interface RoleDef {
  /** Human-readable display name. */
  name: string;
  /** Short description for tool-routing and UI display. */
  description: string;
  /** Key into BUNDLED_PROMPTS for the system prompt markdown. */
  promptKey: string;
  /** Default tool names the role has access to. */
  tools: readonly string[];
  /** Capabilities advertised on the mesh network. */
  capabilities: readonly string[];
  /** Compaction instructions for context management. */
  compaction: string;
  /** Max conversation turns before mandatory compaction. */
  maxTurns: number;
}

const READ = ["read", "grep", "glob", "ls"] as const;
const WRITE = ["write", "edit", "apply_patch", "bash"] as const;
const INTERACT = ["ask_confirm", "ask_choice", "ask_text"] as const;
const PLAN = ["glorp_update_plan"] as const;

export const ROLE_DEFS: Readonly<Record<string, RoleDef>> = {
  generator: {
    name: "Generator",
    description:
      "Produces work artifacts (code, plans, specs) in a generate-evaluate loop. Full tool access.",
    promptKey: "agents/generator.md",
    tools: [...READ, ...WRITE, ...INTERACT, ...PLAN, "web_fetch"],
    capabilities: ["generate", "plan", "interact"],
    compaction:
      "Preserve requirements gathered, decisions made, artifacts produced, and evaluator feedback. Drop search narration and tool output already reduced to conclusions.",
    maxTurns: 30,
  },
  evaluator: {
    name: "Evaluator",
    description:
      "Verifies generator output against checkpoint criteria. Read-only, returns a structured verdict.",
    promptKey: "agents/evaluator.md",
    tools: [...READ],
    capabilities: ["evaluate", "verify"],
    compaction:
      "Preserve all verdict decisions, checkpoint names, criteria checked, and feedback given. Drop file-reading output already reduced to findings.",
    maxTurns: 10,
  },
  researcher: {
    name: "Researcher",
    description:
      "Investigates code or docs and returns a concise answer with file:line citations.",
    promptKey: "agents/researcher.md",
    tools: [...READ, "web_fetch"],
    capabilities: ["research", "search"],
    compaction:
      "Preserve findings with file:line citations and URLs. Drop search-step narration and intermediate tool output.",
    maxTurns: 12,
  },
  builder: {
    name: "Builder",
    description:
      "Autonomous implementation agent. Full read/write tools, runs in background, verifies its own output.",
    promptKey: "agents/builder.md",
    tools: [...READ, ...WRITE, "web_fetch"],
    capabilities: ["build", "implement"],
    compaction:
      "Preserve files changed with reasons, compilation and test results, and remaining work. Drop search narration and read output.",
    maxTurns: 25,
  },
  planner: {
    name: "Planner",
    description:
      "Designs an executable methodology without writing code. Use for planning and architecture tradeoffs.",
    promptKey: "agents/planner.md",
    tools: [...READ],
    capabilities: ["plan", "design"],
    compaction:
      "Preserve the plan document, open questions, and key architectural decisions. Drop exploratory reads already incorporated into the plan.",
    maxTurns: 6,
  },
  reviewer: {
    name: "Reviewer",
    description:
      "Second-opinion code reviewer. Returns a severity-tagged punch-list with file:line references.",
    promptKey: "agents/reviewer.md",
    tools: [...READ],
    capabilities: ["review", "verify"],
    compaction:
      "Preserve findings with severity tags and file:line references. Drop file-reading narration.",
    maxTurns: 8,
  },
};

/** Load the system prompt for a role, interpolating template variables. */
export function rolePrompt(role: string, vars: Record<string, string> = {}): string {
  const def = ROLE_DEFS[role];
  if (!def) throw new Error(`Unknown role in registry: ${role}`);
  return readPrompt(def.promptKey, vars);
}

/** Get a role definition, throwing on unknown role. */
export function roleDef(role: string): RoleDef {
  const def = ROLE_DEFS[role];
  if (!def) throw new Error(`Unknown role in registry: ${role}`);
  return def;
}
