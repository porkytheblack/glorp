/**
 * Skills / system_prompt / mcp sections of the v2 template engine. The
 * orchestrator (`engine.ts`) owns ordering, the secrets set, interpolation, and
 * redaction; repo cloning lives in `engine-repos.ts`. Every template-author
 * string reaches these functions already wired to the shared interpolation +
 * secrets seam, so secrets are scrubbed before they can leave the host.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TemplateError, type Template, type TemplateSkill } from "./types.ts";
import { isWithin, type Interpolator } from "./engine-shared.ts";
import type { ProvisionContext } from "./engine.ts";

/**
 * Install every declared skill under `<workspace>/.claude/skills/<name>/` — the
 * exact layout the agent's extension loader discovers (see extensions-loader.ts).
 */
export function provisionSkills(
  template: Template,
  workspace: string,
  ctx: ProvisionContext,
  interp: Interpolator,
): void {
  const skillsRoot = path.join(workspace, ".claude", "skills");
  for (const skill of template.skills ?? []) {
    if ("from" in skill) installFromSkill(skill, skillsRoot, ctx);
    else if ("files" in skill) installResolvedSkill(skill, skillsRoot, interp);
    else installInlineSkill(skill, skillsRoot, interp);
  }
}

/**
 * A registry-resolved multi-file skill (companion-service spec §3.3): the
 * source inlined every file, so this is pure materialisation — confined to the
 * skill folder, and a SKILL.md must be among the files or the loader would
 * never discover the result.
 */
function installResolvedSkill(
  skill: Extract<TemplateSkill, { files: unknown }>,
  skillsRoot: string,
  interp: Interpolator,
): void {
  if (!skill.files.some((f) => f.path === "SKILL.md")) {
    throw new TemplateError(`skill '${skill.name}' has no SKILL.md among its files`);
  }
  const dir = path.join(skillsRoot, skill.name);
  for (const file of skill.files) {
    const abs = path.resolve(dir, file.path);
    if (!isWithin(dir, abs)) {
      throw new TemplateError(`skill '${skill.name}' file '${file.path}' escapes the skill folder`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, interp(file.content));
  }
}

function installFromSkill(skill: Extract<TemplateSkill, { from: string }>, skillsRoot: string, ctx: ProvisionContext): void {
  const source = path.resolve(ctx.templatesDir, skill.from);
  if (!isWithin(ctx.templatesDir, source)) {
    throw new TemplateError(`skill source '${skill.from}' escapes the templates directory`);
  }
  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new TemplateError(`skill source '${skill.from}' has no SKILL.md`);
  }
  const installName = skill.name ?? path.basename(skill.from.replace(/\/+$/, ""));
  const dest = path.join(skillsRoot, installName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
}

function installInlineSkill(
  skill: Extract<TemplateSkill, { content: string }>,
  skillsRoot: string,
  interp: Interpolator,
): void {
  const dir = path.join(skillsRoot, skill.name);
  fs.mkdirSync(dir, { recursive: true });
  const body = interp(skill.content);
  // Synthesize front-matter only when the author didn't write their own, so the
  // loader always finds a `name:`/`description:` header to route on.
  const content = body.startsWith("---")
    ? body
    : `---\nname: ${skill.name}\ndescription: ${skill.description ?? skill.name}\n---\n\n${body}`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
}

/**
 * Materialise the template's system prompt. It normally lands at
 * `<workspace>/GLORP.md`, which project-instruction discovery folds into the
 * agent's prompt. But if a repo clone already dropped a GLORP.md, we must not
 * clobber it — so we write GLORP.override.md instead. project-instructions.ts
 * lists GLORP files as ["GLORP.override.md", "GLORP.md", "glorp.md"] and stops
 * at the first that exists, so the override WINS and the template author's
 * prompt still applies without destroying the repo's own file.
 */
export function provisionSystemPrompt(template: Template, workspace: string, interp: Interpolator): void {
  if (template.system_prompt === undefined) return;
  const body = interp(template.system_prompt);
  const hasRepoGlorp = fs.existsSync(path.join(workspace, "GLORP.md"));
  const file = hasRepoGlorp ? "GLORP.override.md" : "GLORP.md";
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, file), body);
}

/**
 * Provision each declared MCP provider through the mcpgen callback, with the url
 * and every identity header value interpolated first. A missing callback is a
 * configuration error; a provider failure is wrapped with its name and redacted.
 */
export async function provisionMcp(
  template: Template,
  workspace: string,
  ctx: ProvisionContext,
  interp: Interpolator,
  redact: (text: string) => string,
): Promise<void> {
  const providers = template.mcp ?? [];
  if (providers.length === 0) return;
  if (!ctx.provisionMcp) {
    throw new TemplateError("template declares mcp providers but no MCP provisioner is configured");
  }
  for (const provider of providers) {
    const resolved = {
      provider: provider.provider,
      url: interp(provider.url),
      defaultIdentity: provider.defaultIdentity,
      identities: (provider.identities ?? []).map((id) => ({
        name: id.name,
        headers: id.headers
          ? Object.fromEntries(Object.entries(id.headers).map(([k, v]) => [k, interp(v)]))
          : undefined,
      })),
    };
    try {
      await ctx.provisionMcp(workspace, resolved);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new TemplateError(`mcp provider '${provider.provider}': ${redact(raw)}`);
    }
  }
}
