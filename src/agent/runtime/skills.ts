import type { Glove } from "glove-core/glove";
import type { LoadedSkill } from "../extensions-loader.ts";

export function registerBuiltInSkills(builder: Glove): void {
  builder.defineSkill({
    name: "concise",
    description: "Trim verbosity for this exchange",
    exposeToAgent: true,
    handler: async () => "Be terse. Two-sentence answers. No idioms.",
  });
}

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
