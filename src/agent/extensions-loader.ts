import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * On-disk skill bundle. A skill is a directory containing SKILL.md (the
 * body the model is shown when the skill fires) and optional reference
 * files the agent can read on demand via the `read` tool.
 */
export interface LoadedSkill {
  name: string;
  description: string;
  /** Full body of SKILL.md (front-matter stripped). */
  body: string;
  /** Path of the source SKILL.md. */
  sourcePath: string;
  /** Source root, e.g. ".claude" or ".agents" — used for dedupe reporting. */
  source: "claude" | "agents";
  /** Where the source lives — workspace or home. */
  scope: "workspace" | "home";
  /** Other .md files in the same directory the agent can `read` for detail. */
  referencePaths: string[];
}

/**
 * On-disk subagent definition. Modelled on Claude Code's
 * `.claude/agents/<name>.md` convention: YAML front-matter sets metadata,
 * the body is the system prompt the child Glove receives.
 */
export interface LoadedSubagent {
  name: string;
  description: string;
  /** Body of the file with front-matter stripped — used as systemPrompt. */
  systemPrompt: string;
  /** Optional comma-separated tool list from front-matter, lowercase. */
  toolAllowlist?: string[];
  /** Optional model override hint — passed through but currently informational. */
  modelHint?: string;
  sourcePath: string;
  source: "claude" | "agents";
  scope: "workspace" | "home";
}

export interface ExtensionsBundle {
  skills: LoadedSkill[];
  subagents: LoadedSubagent[];
  /** Duplicates that lost the dedupe contest; reported so we can log them. */
  shadowedSkills: Array<{ name: string; lost: string; kept: string }>;
  shadowedSubagents: Array<{ name: string; lost: string; kept: string }>;
}

/**
 * Discover all skills and subagents on disk and return them deduped.
 * Search order (more-specific wins on a name conflict):
 *   1. <workspace>/.claude
 *   2. <workspace>/.agents
 *   3. ~/.claude
 *   4. ~/.agents
 *
 * Each level adds entries only if a name isn't already taken.
 */
export function discoverExtensions(workspace: string, homeDir = os.homedir()): ExtensionsBundle {
  const searchRoots: Array<{ dir: string; source: "claude" | "agents"; scope: "workspace" | "home" }> = [
    { dir: path.join(workspace, ".claude"), source: "claude", scope: "workspace" },
    { dir: path.join(workspace, ".agents"), source: "agents", scope: "workspace" },
    { dir: path.join(homeDir, ".claude"), source: "claude", scope: "home" },
    { dir: path.join(homeDir, ".agents"), source: "agents", scope: "home" },
  ];

  const skills = new Map<string, LoadedSkill>();
  const subagents = new Map<string, LoadedSubagent>();
  const shadowedSkills: ExtensionsBundle["shadowedSkills"] = [];
  const shadowedSubagents: ExtensionsBundle["shadowedSubagents"] = [];

  for (const root of searchRoots) {
    // Skills live at <root>/skills/<name>/SKILL.md
    const skillsDir = path.join(root.dir, "skills");
    if (fs.existsSync(skillsDir)) {
      for (const skill of loadSkillsIn(skillsDir, root.source, root.scope)) {
        if (skills.has(skill.name)) {
          shadowedSkills.push({
            name: skill.name,
            lost: skill.sourcePath,
            kept: skills.get(skill.name)!.sourcePath,
          });
        } else {
          skills.set(skill.name, skill);
        }
      }
    }

    // Subagents live at <root>/agents/<name>.md
    const agentsDir = path.join(root.dir, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const sub of loadSubagentsIn(agentsDir, root.source, root.scope)) {
        if (subagents.has(sub.name)) {
          shadowedSubagents.push({
            name: sub.name,
            lost: sub.sourcePath,
            kept: subagents.get(sub.name)!.sourcePath,
          });
        } else {
          subagents.set(sub.name, sub);
        }
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

function loadSkillsIn(
  dir: string,
  source: "claude" | "agents",
  scope: "workspace" | "home",
): LoadedSkill[] {
  const out: LoadedSkill[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const skillDir = path.join(dir, e.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      const raw = fs.readFileSync(skillFile, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      const description = String(
        frontmatter.description ??
          frontmatter.summary ??
          firstLine(body) ??
          `Skill bundled at ${path.relative(skillDir, skillFile)}`,
      );
      // Other markdown files in the same directory the agent can navigate to.
      const refs: string[] = [];
      try {
        for (const f of fs.readdirSync(skillDir, { withFileTypes: true })) {
          if (f.isFile() && f.name !== "SKILL.md" && f.name.endsWith(".md")) {
            refs.push(path.join(skillDir, f.name));
          }
        }
      } catch {}
      out.push({
        name: String(frontmatter.name ?? e.name),
        description,
        body,
        sourcePath: skillFile,
        source,
        scope,
        referencePaths: refs,
      });
    } catch {
      // Skip unreadable skill — discovery is best-effort.
    }
  }
  return out;
}

function loadSubagentsIn(
  dir: string,
  source: "claude" | "agents",
  scope: "workspace" | "home",
): LoadedSubagent[] {
  const out: LoadedSubagent[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const file = path.join(dir, e.name);
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      const name = String(frontmatter.name ?? e.name.replace(/\.md$/, ""));
      const description = String(
        frontmatter.description ??
          firstLine(body) ??
          `User-defined subagent (${name})`,
      );
      // Tools list: comma-separated lowercase names.
      let toolAllowlist: string[] | undefined;
      if (typeof frontmatter.tools === "string") {
        toolAllowlist = frontmatter.tools
          .split(",")
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean);
      } else if (Array.isArray(frontmatter.tools)) {
        toolAllowlist = (frontmatter.tools as string[])
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
      }
      out.push({
        name,
        description,
        systemPrompt: body.trim(),
        toolAllowlist,
        modelHint: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
        sourcePath: file,
        source,
        scope,
      });
    } catch {
      // Skip unreadable file — best-effort.
    }
  }
  return out;
}

/**
 * Tiny YAML-frontmatter parser. Supports the subset we actually use:
 *   key: value          → string
 *   key: [a, b, c]      → array of strings
 *   key:                → start of block, followed by `- item` lines
 *     - item
 *
 * No nesting, no anchors, no flow scalars beyond single-line arrays. If
 * the file doesn't start with `---\n`, treats the whole thing as body
 * with no frontmatter.
 */
/**
 * Routing one-liner for a subagent/skill description. Agent-file frontmatter
 * descriptions are often multi-KB (usage guides, <example> blocks) — that text
 * belongs to the subagent's own prompt. The parent's roster listings (dispatch
 * tool + system prompt section) only need enough to route: clamping here took
 * a real session's request from 122.6kB to ~60kB, i.e. ~2× more work per
 * provider quota-day.
 */
export function routingLine(description: string, max = 220): string {
  const firstLine = description.split("\n", 1)[0]!.trim();
  // Prefer a sentence boundary when one lands inside the cap.
  const sentence = firstLine.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? firstLine;
  const line = sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
  return line || description.slice(0, max);
}

export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  // Tolerate \r\n line endings; normalise for the splitter below.
  const normalised = raw.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) {
    return { frontmatter: {}, body: normalised };
  }
  const closeIdx = normalised.indexOf("\n---", 4);
  if (closeIdx === -1) {
    return { frontmatter: {}, body: normalised };
  }
  const block = normalised.slice(4, closeIdx);
  // Body starts after the closing --- line.
  const afterCloseStart = closeIdx + 4;
  const newlineAfter = normalised.indexOf("\n", afterCloseStart);
  const body = newlineAfter === -1 ? "" : normalised.slice(newlineAfter + 1);

  const frontmatter: Record<string, unknown> = {};
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (rest === "") {
      // Possible block-style list.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j]!;
        const m = next.match(/^\s*-\s+(.+)$/);
        if (!m) break;
        items.push(unquote(m[1]!.trim()));
        j++;
      }
      frontmatter[key] = items.length > 0 ? items : "";
      i = j;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      // Inline array: [a, b, c]
      const inner = rest.slice(1, -1).trim();
      frontmatter[key] =
        inner === ""
          ? []
          : inner.split(",").map((s) => unquote(s.trim()));
    } else {
      frontmatter[key] = unquote(rest);
    }
    i++;
  }
  return { frontmatter, body };
}

function unquote(s: string): string {
  if (s.length >= 2 && (s.startsWith('"') || s.startsWith("'"))) {
    const q = s[0];
    if (s.endsWith(q)) return s.slice(1, -1);
  }
  return s;
}

function firstLine(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return undefined;
}
