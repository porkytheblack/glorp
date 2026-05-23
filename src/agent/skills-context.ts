import type { ExtensionsBundle, LoadedSkill, LoadedSubagent } from "./extensions-loader.ts";
import { readPrompt } from "./prompts/loader.ts";
import { estimateTokens, xmlSection } from "./prompts/synthetic.ts";

export interface SkillContextOptions {
  contextLimit: number;
}

export function buildExtensionsContext(
  bundle: ExtensionsBundle,
  opts: SkillContextOptions,
): string {
  const budget = Math.max(1, Math.floor(opts.contextLimit * 0.02));
  const instructions = readPrompt("skill-instructions.md");
  const skills = fitLines(bundle.skills.map(renderSkill), budget - estimateTokens(instructions));
  const subagents = bundle.subagents.map(renderSubagent).join("\n") || "- none";
  const omitted = bundle.skills.length - skills.count;
  const body = [
    instructions,
    "",
    "## Available Skills",
    skills.text || "- none",
    omitted > 0 ? `- ... ${omitted} skill(s) omitted to stay within the 2% context budget.` : "",
    "",
    "## Available Subagents",
    subagents,
  ].filter(Boolean).join("\n");

  return xmlSection("glorp_extensions", {
    max_skill_tokens: budget,
    estimated_tokens: estimateTokens(body),
  }, body);
}

function renderSkill(skill: LoadedSkill): string {
  const folder = skill.sourcePath.replace(/\/SKILL\.md$/, "");
  return `- /${skill.name}: ${skill.description}\n  source: ${skill.sourcePath}\n  folder: ${folder}`;
}

function renderSubagent(sub: LoadedSubagent): string {
  return `- @${sub.name}: ${sub.description}\n  source: ${sub.sourcePath}`;
}

function fitLines(lines: string[], budget: number): { text: string; count: number } {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = estimateTokens(line);
    if (kept.length > 0 && used + cost > budget) break;
    if (used + cost > budget && kept.length === 0) break;
    kept.push(line);
    used += cost;
  }
  return { text: kept.join("\n"), count: kept.length };
}
