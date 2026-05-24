import type { Glove } from "glove-core/glove";
import type { LoadedSkill } from "../extensions-loader.ts";

interface BuiltInSkill {
  name: string;
  description: string;
  body: () => string;
}

const BUILT_IN_SKILLS: ReadonlyArray<BuiltInSkill> = [
  {
    name: "concise",
    description: "Trim verbosity for this exchange",
    body: () => "Be terse. Two-sentence answers. No idioms.",
  },
];

/**
 * Register skills discovered on disk. Workspace-local skills always take
 * precedence over user-home (globally installed) skills — that precedence
 * is enforced by `discoverExtensions`, which walks `<workspace>/.claude`,
 * `<workspace>/.agents`, `~/.claude`, `~/.agents` in order and keeps the
 * first occurrence of each name.
 */
export function registerDiskSkills(builder: Glove, skills: LoadedSkill[]): void {
  for (const skill of skills) {
    builder.defineSkill({
      name: skill.name,
      description: skill.description,
      exposeToAgent: true,
      handler: async () => skillPayload(skill),
    });
  }
}

/**
 * Register Glorp's built-in skills. Disk skills (workspace or home) of the
 * same name win — a user that defines `concise` in their `.claude/skills`
 * folder is choosing to override Glorp's stock version, and the harness
 * must respect that. This function should be called AFTER
 * `registerDiskSkills` so the skip-on-collision check sees them.
 */
export function registerBuiltInSkills(builder: Glove, diskSkills: LoadedSkill[] = []): void {
  const claimedByDisk = new Set(diskSkills.map((s) => s.name));
  for (const skill of BUILT_IN_SKILLS) {
    if (claimedByDisk.has(skill.name)) continue;
    builder.defineSkill({
      name: skill.name,
      description: skill.description,
      exposeToAgent: true,
      handler: async () => skill.body(),
    });
  }
}

function skillPayload(skill: LoadedSkill): string {
  const refs = skill.referencePaths.length
    ? "\n\nReference files in this skill folder:\n" +
      skill.referencePaths.map((p) => `- ${p}`).join("\n")
    : "";
  return [
    `<skill name="${skill.name}" source="${skill.sourcePath}">`,
    skill.body.trim(),
    refs,
    "</skill>",
  ].join("\n");
}
