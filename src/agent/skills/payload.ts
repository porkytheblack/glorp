import type { LoadedSkill } from "./loader.ts";

const MAX_SKILL_PAYLOAD_CHARS = 12_000;
const MAX_SKILL_INDEX_HEADINGS = 80;

/**
 * Build the text injected into the agent's context when a skill fires.
 * The body is wrapped in a `<skill>` tag so the model sees a clear
 * boundary between the skill payload and surrounding conversation —
 * Observation 4 (XML in markdown for synthetic messages).
 *
 * If the body fits the cap, return it whole with a reference-files hint.
 * Otherwise return a truncated body + a heading index so the agent can
 * navigate to specific sections with `read`. Both branches end with a
 * pointer to sibling reference files so the agent can pull them in
 * piecemeal when a section needs more depth.
 */
export function skillPayload(skill: LoadedSkill): string {
  const refsHint = formatReferenceHint(skill);
  const body = skill.body.length <= MAX_SKILL_PAYLOAD_CHARS
    ? skill.body
    : truncatedWithIndex(skill);
  return `<skill name="${skill.name}" source="${skill.sourcePath}">\n${body}${refsHint}\n</skill>`;
}

function truncatedWithIndex(skill: LoadedSkill): string {
  return [
    skill.body.slice(0, MAX_SKILL_PAYLOAD_CHARS),
    "",
    "---",
    `[Skill body truncated from ${skill.body.length} to ${MAX_SKILL_PAYLOAD_CHARS} characters. ` +
      `Source: ${skill.sourcePath}. Use grep or read with the line offsets below for specific sections.]`,
    "",
    headingIndex(skill.body, skill.sourcePath),
  ].join("\n");
}

function formatReferenceHint(skill: LoadedSkill): string {
  if (skill.referencePaths.length === 0) return "";
  const lines = skill.referencePaths.map((p) => `  ${p}`).join("\n");
  return `\n\n---\nReference files in this skill (read only the file you need):\n${lines}`;
}

function headingIndex(body: string, sourcePath: string): string {
  const lines = body.split("\n");
  const headings: Array<{ line: number; level: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[i]!);
    if (!match) continue;
    headings.push({
      line: i + 1,
      level: match[1]!.length,
      title: match[2]!.replace(/\s+/g, " ").trim(),
    });
    if (headings.length >= MAX_SKILL_INDEX_HEADINGS) break;
  }
  if (headings.length === 0) {
    return `Heading index unavailable. Read targeted ranges from ${sourcePath}.`;
  }
  const rows = headings.map((h) => `- line ${h.line}: ${"  ".repeat(Math.max(0, h.level - 1))}${h.title}`);
  const more = headings.length >= MAX_SKILL_INDEX_HEADINGS
    ? `\n- ... heading index capped at ${MAX_SKILL_INDEX_HEADINGS}; use grep for later sections.`
    : "";
  return `Heading index for omitted sections in ${sourcePath}:\n${rows.join("\n")}${more}`;
}
