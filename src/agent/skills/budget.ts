import type { LoadedSkill } from "./loader.ts";

/** Rough 4 chars-per-token estimate. Good enough for budgeting decisions. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** 2% of the context window — the budget we let skill metadata occupy. */
export function skillIndexBudget(contextLimit: number): number {
  return Math.floor(contextLimit * 0.02);
}

export interface SkillIndexEntry {
  name: string;
  description: string;
  sourcePath: string;
  estimatedBodyTokens: number;
  /** True when the entry was kept inside the index budget. */
  included: boolean;
}

/**
 * Build a list of skill index entries, marking which ones survive the
 * budget. Each row gets `~80 tokens` of metadata reserve; whatever fits
 * inside `budget` makes the cut, the rest are flagged `included: false`
 * but kept so the loader can still report what was skipped.
 */
export function buildSkillIndex(
  skills: LoadedSkill[],
  budget: number,
): SkillIndexEntry[] {
  const entries: SkillIndexEntry[] = [];
  let used = 0;
  for (const skill of skills) {
    const entryTokens = estimateRowTokens(skill);
    const included = used + entryTokens <= budget;
    if (included) used += entryTokens;
    entries.push({
      name: skill.name,
      description: skill.description,
      sourcePath: skill.sourcePath,
      estimatedBodyTokens: estimateTokens(skill.body),
      included,
    });
  }
  return entries;
}

function estimateRowTokens(skill: LoadedSkill): number {
  return estimateTokens(`- ${skill.name}: ${skill.description} (${skill.sourcePath})`) + 4;
}

/**
 * Render the skill index as a system-prompt section. Listed skills can be
 * invoked by name through `glove_invoke_skill`; the agent should consult
 * `sourcePath` (and the skill's reference directory) when it needs the
 * full body.
 */
export function renderSkillIndex(entries: SkillIndexEntry[]): string {
  if (entries.length === 0) return "";
  const included = entries.filter((e) => e.included);
  const skipped = entries.filter((e) => !e.included);
  const lines: string[] = [
    "# Available skills",
    "",
    "Call `glove_invoke_skill({ name })` to load a skill's body on demand.",
    "When a skill points to a source path, you may also read sibling .md files",
    "in the same directory with the `read` tool for extra detail.",
    "",
  ];
  for (const e of included) {
    lines.push(`- \`${e.name}\` — ${e.description} _(body ≈ ${e.estimatedBodyTokens} tokens; source: ${e.sourcePath})_`);
  }
  if (skipped.length > 0) {
    lines.push("", `_${skipped.length} more skill(s) elided to stay under budget; ask the user if you need them._`);
  }
  return lines.join("\n");
}
