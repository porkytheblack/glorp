import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter } from "./frontmatter.ts";

export interface LoadedSkill {
  name: string;
  description: string;
  body: string;
  sourcePath: string;
  source: "claude" | "agents";
  scope: "workspace" | "home";
  referencePaths: string[];
}

export interface LoadedSubagent {
  name: string;
  description: string;
  systemPrompt: string;
  toolAllowlist?: string[];
  modelHint?: string;
  sourcePath: string;
  source: "claude" | "agents";
  scope: "workspace" | "home";
}

export interface ExtensionsBundle {
  skills: LoadedSkill[];
  subagents: LoadedSubagent[];
  shadowedSkills: Array<{ name: string; lost: string; kept: string }>;
  shadowedSubagents: Array<{ name: string; lost: string; kept: string }>;
}

interface Root {
  dir: string;
  source: "claude" | "agents";
  scope: "workspace" | "home";
}

/**
 * Discover all skills and subagents on disk and return them deduped.
 * Search order (more-specific wins on a name conflict):
 *   1. <workspace>/.claude
 *   2. <workspace>/.agents
 *   3. ~/.claude
 *   4. ~/.agents
 */
export function discoverExtensions(workspace: string, homeDir = os.homedir()): ExtensionsBundle {
  const roots: Root[] = [
    { dir: path.join(workspace, ".claude"), source: "claude", scope: "workspace" },
    { dir: path.join(workspace, ".agents"), source: "agents", scope: "workspace" },
    { dir: path.join(homeDir, ".claude"), source: "claude", scope: "home" },
    { dir: path.join(homeDir, ".agents"), source: "agents", scope: "home" },
  ];
  const skills = new Map<string, LoadedSkill>();
  const subagents = new Map<string, LoadedSubagent>();
  const shadowedSkills: ExtensionsBundle["shadowedSkills"] = [];
  const shadowedSubagents: ExtensionsBundle["shadowedSubagents"] = [];

  for (const root of roots) {
    for (const skill of loadSkillsIn(path.join(root.dir, "skills"), root.source, root.scope)) {
      if (skills.has(skill.name)) {
        shadowedSkills.push({ name: skill.name, lost: skill.sourcePath, kept: skills.get(skill.name)!.sourcePath });
      } else {
        skills.set(skill.name, skill);
      }
    }
    for (const sub of loadSubagentsIn(path.join(root.dir, "agents"), root.source, root.scope)) {
      if (subagents.has(sub.name)) {
        shadowedSubagents.push({ name: sub.name, lost: sub.sourcePath, kept: subagents.get(sub.name)!.sourcePath });
      } else {
        subagents.set(sub.name, sub);
      }
    }
  }

  return {
    skills: Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name)),
    subagents: Array.from(subagents.values()).sort((a, b) => a.name.localeCompare(b.name)),
    shadowedSkills,
    shadowedSubagents,
  };
}

function loadSkillsIn(dir: string, source: "claude" | "agents", scope: "workspace" | "home"): LoadedSkill[] {
  const entries = safeReadDirents(dir);
  const out: LoadedSkill[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const skillDir = path.join(dir, e.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const loaded = loadSkillFile(skillFile, skillDir, e.name, source, scope);
    if (loaded) out.push(loaded);
  }
  return out;
}

function loadSkillFile(
  skillFile: string,
  skillDir: string,
  fallbackName: string,
  source: "claude" | "agents",
  scope: "workspace" | "home",
): LoadedSkill | null {
  try {
    const raw = fs.readFileSync(skillFile, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    return {
      name: String(frontmatter.name ?? fallbackName),
      description: String(
        frontmatter.description ?? frontmatter.summary ?? firstLine(body) ?? `Skill ${fallbackName}`,
      ),
      body,
      sourcePath: skillFile,
      source,
      scope,
      referencePaths: collectReferenceFiles(skillDir),
    };
  } catch {
    return null;
  }
}

function collectReferenceFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name !== "SKILL.md" && f.name.endsWith(".md"))
      .map((f) => path.join(dir, f.name));
  } catch {
    return [];
  }
}

function loadSubagentsIn(dir: string, source: "claude" | "agents", scope: "workspace" | "home"): LoadedSubagent[] {
  const entries = safeReadDirents(dir);
  const out: LoadedSubagent[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const file = path.join(dir, e.name);
    try {
      out.push(parseSubagentFile(file, e.name, source, scope));
    } catch {
      // Skip unreadable files — discovery is best-effort.
    }
  }
  return out;
}

function parseSubagentFile(
  file: string,
  fileName: string,
  source: "claude" | "agents",
  scope: "workspace" | "home",
): LoadedSubagent {
  const raw = fs.readFileSync(file, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const name = String(frontmatter.name ?? fileName.replace(/\.md$/, ""));
  return {
    name,
    description: String(frontmatter.description ?? firstLine(body) ?? `User-defined subagent (${name})`),
    systemPrompt: body.trim(),
    toolAllowlist: extractTools(frontmatter.tools),
    modelHint: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
    sourcePath: file,
    source,
    scope,
  };
}

function extractTools(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }
  return undefined;
}

function safeReadDirents(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function firstLine(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return undefined;
}
