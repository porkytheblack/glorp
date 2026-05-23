import type { IGloveRunnable } from "glove-core/glove";
import type { SkillContext } from "glove-core/extensions";
import type { LoadedSkill } from "./loader.ts";
import { skillPayload } from "./payload.ts";
import { buildSkillIndex, renderSkillIndex, skillIndexBudget, type SkillIndexEntry } from "./budget.ts";

/**
 * Register every disk-loaded skill on `glove` with `exposeToAgent: true`.
 * The handler defers reading the body until the agent actually invokes the
 * skill — so unused skills cost nothing beyond the index row in the system
 * prompt (which the caller renders separately via `renderSkillIndex`).
 *
 * `source === "agent"` invocations from within a tool-result loop are
 * suppressed — Observation 5: skills are not allowed to fire in response
 * to a tool result. The handler returns an empty string instead, which
 * glove materialises as an empty injection (no-op turn).
 */
export function registerSkills(
  glove: IGloveRunnable,
  skills: LoadedSkill[],
  contextLimit: number,
): SkillIndexEntry[] {
  const entries = buildSkillIndex(skills, skillIndexBudget(contextLimit));
  const byName = new Map(skills.map((s) => [s.name, s]));
  for (const skill of skills) {
    glove.defineSkill({
      name: skill.name,
      description: skill.description,
      exposeToAgent: true,
      handler: async (ctx: SkillContext) => {
        if (await isTriggeredByToolResult(ctx)) {
          return "[skill invocation suppressed — triggered by a tool result. Call the skill from a fresh user request.]";
        }
        const loaded = byName.get(skill.name);
        return loaded ? skillPayload(loaded) : "[skill no longer available]";
      },
    });
  }
  return entries;
}

/**
 * Detect agent-side invocation that piggy-backs on tool results. The last
 * persisted message at invocation time will carry `tool_results` when the
 * agent's next turn is responding to a tool. We only block in that case;
 * a fresh user message is allowed to flow through normally.
 */
async function isTriggeredByToolResult(ctx: SkillContext): Promise<boolean> {
  if (ctx.source !== "agent") return false;
  const messages = await ctx.controls?.context?.getMessages();
  if (!messages || messages.length === 0) return false;
  const last = messages.at(-1);
  return Array.isArray(last?.tool_results) && last.tool_results.length > 0;
}

export { renderSkillIndex };
