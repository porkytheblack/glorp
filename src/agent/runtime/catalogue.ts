import type { ExtensionCatalogue } from "../glorp-types.ts";
import { HOOK_DESCRIPTIONS } from "./hooks.ts";

export function buildExtensionCatalogue(agent: unknown): ExtensionCatalogue {
  const builtAgent = agent as {
    hooks?: Map<string, unknown>;
    skills?: Map<string, { description?: string; exposeToAgent?: boolean }>;
    subAgents?: Map<string, { description?: string }>;
  };
  const hookNames = builtAgent.hooks
    ? Array.from(builtAgent.hooks.keys())
    : ["compact", "plan", "diff", "clear", "transmissions"];
  const skillEntries = builtAgent.skills
    ? Array.from(builtAgent.skills.entries())
    : [["concise", { description: "Trim verbosity for this exchange", exposeToAgent: true }] as const];
  const subAgentEntries = builtAgent.subAgents
    ? Array.from(builtAgent.subAgents.entries())
    : ([
        ["planner", { description: "design an approach without writing code" }],
        ["researcher", { description: "investigate the codebase or web" }],
        ["reviewer", { description: "review a recent change for issues" }],
      ] as const);

  return {
    slash: [
      ...hookNames.map((name) => ({
        name: `/${name}`,
        description: HOOK_DESCRIPTIONS[name] ?? "hook",
      })),
      ...skillEntries
        .filter(([, s]) => s?.exposeToAgent !== false)
        .map(([name, s]) => ({
          name: `/${name}`,
          description: s?.description ?? "skill",
        })),
      { name: "/help", description: "show commands" },
      { name: "/quit", description: "exit glorp" },
    ],
    mentions: subAgentEntries.map(([name, s]) => ({
      name: `@${name}`,
      description: s?.description ?? "subagent",
    })),
  };
}
