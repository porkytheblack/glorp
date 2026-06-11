/**
 * The registry half of the companion service (spec §3): serves Template v2
 * documents from a directory, RESOLVING library skills server-side — every
 * `{"from": "skills/x"}` entry becomes the inline `files` form before it
 * crosses the wire, so the client stays one GET. ETags are content hashes;
 * the library is re-read per revalidation (template dirs are small, and it
 * means edits show up without a restart).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { TemplateStore } from "../garage/templates/store.ts";
import type { Template, TemplateSkill, TemplateSkillFile } from "../garage/templates/types.ts";

export interface ResolvedRegistry {
  templates: Template[];
  etag: string;
}

export function loadResolvedTemplates(dir: string): ResolvedRegistry {
  const templates = new TemplateStore(dir)
    .list()
    .map((t) => resolveTemplate(t, dir))
    .filter((t): t is Template => t !== undefined);
  const etag = `"${createHash("sha1").update(JSON.stringify(templates)).digest("hex").slice(0, 16)}"`;
  return { templates, etag };
}

/** Inline every `from` skill; drop templates whose skill sources are broken. */
function resolveTemplate(t: Template, dir: string): Template | undefined {
  if (!t.skills?.some((s) => "from" in s)) return t;
  try {
    const skills: TemplateSkill[] = t.skills.map((s) => ("from" in s ? resolveSkill(s, dir) : s));
    return { ...t, skills };
  } catch (err) {
    console.warn(`[glorp-companion] skipping template '${t.name}': ${(err as Error).message}`);
    return undefined;
  }
}

function resolveSkill(skill: Extract<TemplateSkill, { from: string }>, dir: string): TemplateSkill {
  const source = path.resolve(dir, skill.from);
  const rel = path.relative(path.resolve(dir), source);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`skill source '${skill.from}' escapes the templates directory`);
  }
  const files = walk(source, source);
  if (!files.some((f) => f.path === "SKILL.md")) {
    throw new Error(`skill source '${skill.from}' has no SKILL.md`);
  }
  return { name: skill.name ?? path.basename(skill.from.replace(/\/+$/, "")), files };
}

function walk(dir: string, root: string): TemplateSkillFile[] {
  const out: TemplateSkillFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs, root));
    else out.push({ path: path.relative(root, abs).split(path.sep).join("/"), content: fs.readFileSync(abs, "utf-8") });
  }
  return out;
}
