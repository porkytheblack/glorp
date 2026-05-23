import type { IGloveRunnable } from "glove-core/glove";
import type { ExtensionCatalogue } from "./types.ts";

const HOOK_DESCRIPTIONS: Record<string, string> = {
  plan: "switch to plan-first mode for this turn",
  diff: "list files changed since last user message",
  compact: "force a context compaction now",
  clear: "compact and reset the working slate",
  transmissions: "ask about the homeworld-comms panel",
};

interface BuiltAgentInternals {
  hooks?: Map<string, unknown>;
  skills?: Map<string, { description?: string; exposeToAgent?: boolean }>;
  subAgents?: Map<string, { description?: string }>;
}

/** Build the autocomplete catalogue the input bar consumes. */
export function buildCatalogue(agent: IGloveRunnable): ExtensionCatalogue {
  const internals = agent as unknown as BuiltAgentInternals;
  const hookNames = internals.hooks
    ? Array.from(internals.hooks.keys())
    : ["compact", "plan", "diff", "clear", "transmissions"];
  const skillEntries = internals.skills
    ? Array.from(internals.skills.entries())
    : [["concise", { description: "Trim verbosity for this exchange" }] as const];
  const subAgentEntries = internals.subAgents
    ? Array.from(internals.subAgents.entries())
    : [];

  const exposedSkillHints = skillEntries
    .filter(([, s]) => (s as { exposeToAgent?: boolean })?.exposeToAgent !== false)
    .map(([name, s]) => ({ name, description: (s as { description?: string })?.description ?? "skill" }));

  return {
    slash: [
      ...hookNames.map((name) => ({ name: `/${name}`, description: HOOK_DESCRIPTIONS[name] ?? "hook" })),
      ...exposedSkillHints.map((s) => ({ name: `/${s.name}`, description: s.description })),
      { name: "/help", description: "show commands" },
      { name: "/quit", description: "exit glorp" },
    ],
    skills: exposedSkillHints.map((s) => ({ name: `$${s.name}`, description: s.description })),
    mentions: subAgentEntries.map(([name, s]) => ({
      name: `@${name}`,
      description: (s as { description?: string })?.description ?? "subagent",
    })),
  };
}
