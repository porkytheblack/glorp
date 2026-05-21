import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  discoverExtensions,
  parseFrontmatter,
} from "../src/agent/extensions-loader.ts";

let workspace: string;
let home: string;

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-ext-ws-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-ext-home-"));
});

afterEach(() => {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {}
});

describe("parseFrontmatter", () => {
  test("returns whole body when no front-matter", () => {
    const { frontmatter, body } = parseFrontmatter("# Just markdown\n\nbody text");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just markdown\n\nbody text");
  });

  test("parses simple key:value pairs", () => {
    const { frontmatter, body } = parseFrontmatter(
      "---\nname: code-reviewer\ndescription: Reviews code\n---\nBody",
    );
    expect(frontmatter.name).toBe("code-reviewer");
    expect(frontmatter.description).toBe("Reviews code");
    expect(body).toBe("Body");
  });

  test("strips single/double quotes around values", () => {
    const { frontmatter } = parseFrontmatter(
      '---\nname: "code-reviewer"\ndescription: \'Reviews code\'\n---\n',
    );
    expect(frontmatter.name).toBe("code-reviewer");
    expect(frontmatter.description).toBe("Reviews code");
  });

  test("parses inline arrays", () => {
    const { frontmatter } = parseFrontmatter("---\ntools: [Read, Grep, Glob]\n---\n");
    expect(frontmatter.tools).toEqual(["Read", "Grep", "Glob"]);
  });

  test("parses block-style arrays", () => {
    const { frontmatter } = parseFrontmatter(
      "---\ntools:\n  - Read\n  - Grep\n  - Glob\n---\nbody",
    );
    expect(frontmatter.tools).toEqual(["Read", "Grep", "Glob"]);
  });

  test("ignores comment lines and blanks inside front-matter", () => {
    const { frontmatter } = parseFrontmatter(
      "---\n# a comment\nname: foo\n\ndescription: bar\n---\n",
    );
    expect(frontmatter.name).toBe("foo");
    expect(frontmatter.description).toBe("bar");
  });

  test("tolerates CRLF line endings", () => {
    const { frontmatter, body } = parseFrontmatter(
      "---\r\nname: x\r\n---\r\nbody",
    );
    expect(frontmatter.name).toBe("x");
    expect(body).toBe("body");
  });

  test("no closing --- → treats whole input as body", () => {
    const { frontmatter, body } = parseFrontmatter("---\nname: foo\nbody no close");
    expect(frontmatter).toEqual({});
    expect(body).toContain("name: foo");
  });
});

describe("discoverExtensions — skills", () => {
  test("loads a skill from <workspace>/.claude/skills/<name>/SKILL.md", () => {
    write(
      path.join(workspace, ".claude/skills/python/SKILL.md"),
      "---\ndescription: Python dev skill\n---\n# Python\n\nUse this for Python code.",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills.length).toBe(1);
    expect(bundle.skills[0]?.name).toBe("python");
    expect(bundle.skills[0]?.description).toBe("Python dev skill");
    expect(bundle.skills[0]?.scope).toBe("workspace");
    expect(bundle.skills[0]?.source).toBe("claude");
  });

  test("loads a skill from <workspace>/.agents/skills/<name>/SKILL.md", () => {
    write(
      path.join(workspace, ".agents/skills/rust/SKILL.md"),
      "---\ndescription: Rust skill\n---\nbody",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills[0]?.name).toBe("rust");
    expect(bundle.skills[0]?.source).toBe("agents");
  });

  test("loads from ~/.claude/skills/<name>/SKILL.md", () => {
    write(
      path.join(home, ".claude/skills/global/SKILL.md"),
      "---\ndescription: Global skill\n---\nbody",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills[0]?.name).toBe("global");
    expect(bundle.skills[0]?.scope).toBe("home");
  });

  test("dedupe: workspace wins over home", () => {
    write(
      path.join(workspace, ".claude/skills/foo/SKILL.md"),
      "---\ndescription: workspace foo\n---\n",
    );
    write(
      path.join(home, ".claude/skills/foo/SKILL.md"),
      "---\ndescription: home foo\n---\n",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills.length).toBe(1);
    expect(bundle.skills[0]?.description).toBe("workspace foo");
    expect(bundle.shadowedSkills.length).toBe(1);
    expect(bundle.shadowedSkills[0]?.name).toBe("foo");
  });

  test("dedupe: .claude wins over .agents within the same scope", () => {
    write(
      path.join(workspace, ".claude/skills/bar/SKILL.md"),
      "---\ndescription: claude version\n---\n",
    );
    write(
      path.join(workspace, ".agents/skills/bar/SKILL.md"),
      "---\ndescription: agents version\n---\n",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills.length).toBe(1);
    expect(bundle.skills[0]?.source).toBe("claude");
    expect(bundle.shadowedSkills.length).toBe(1);
  });

  test("discovers reference .md files alongside SKILL.md", () => {
    const dir = path.join(workspace, ".claude/skills/multi/SKILL.md");
    write(dir, "---\ndescription: multi\n---\nbody");
    write(path.join(workspace, ".claude/skills/multi/api-reference.md"), "ref");
    write(path.join(workspace, ".claude/skills/multi/examples.md"), "ex");
    const bundle = discoverExtensions(workspace, home);
    const skill = bundle.skills[0]!;
    expect(skill.referencePaths.length).toBe(2);
    expect(skill.referencePaths.some((p) => p.endsWith("api-reference.md"))).toBe(true);
    expect(skill.referencePaths.some((p) => p.endsWith("examples.md"))).toBe(true);
  });

  test("skill without front-matter uses first body line as description", () => {
    write(
      path.join(workspace, ".claude/skills/raw/SKILL.md"),
      "# Title\n\nThis is the description line.\n\nMore body.",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills[0]?.description).toBe("This is the description line.");
  });

  test("ignores directories that don't have a SKILL.md", () => {
    fs.mkdirSync(path.join(workspace, ".claude/skills/empty"), { recursive: true });
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills.length).toBe(0);
  });
});

describe("discoverExtensions — subagents", () => {
  test("loads a subagent from <workspace>/.claude/agents/<name>.md", () => {
    write(
      path.join(workspace, ".claude/agents/code-reviewer.md"),
      "---\nname: code-reviewer\ndescription: Reviews code\ntools: Read, Grep, Glob\n---\nYou are a reviewer.",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.subagents.length).toBe(1);
    const sub = bundle.subagents[0]!;
    expect(sub.name).toBe("code-reviewer");
    expect(sub.description).toBe("Reviews code");
    expect(sub.toolAllowlist).toEqual(["read", "grep", "glob"]);
    expect(sub.systemPrompt).toBe("You are a reviewer.");
  });

  test("name falls back to filename when front-matter is missing", () => {
    write(
      path.join(workspace, ".claude/agents/quick-helper.md"),
      "---\ndescription: helps\n---\nbody",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.subagents[0]?.name).toBe("quick-helper");
  });

  test("dedupe: workspace wins over home for subagents too", () => {
    write(
      path.join(workspace, ".claude/agents/foo.md"),
      "---\ndescription: workspace\n---\nbody",
    );
    write(
      path.join(home, ".claude/agents/foo.md"),
      "---\ndescription: home\n---\nbody",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.subagents.length).toBe(1);
    expect(bundle.subagents[0]?.description).toBe("workspace");
    expect(bundle.shadowedSubagents.length).toBe(1);
  });

  test("tools as block list is supported", () => {
    write(
      path.join(workspace, ".claude/agents/blocky.md"),
      "---\ndescription: x\ntools:\n  - Read\n  - Grep\n---\nbody",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.subagents[0]?.toolAllowlist).toEqual(["read", "grep"]);
  });

  test("model hint passes through", () => {
    write(
      path.join(workspace, ".claude/agents/m.md"),
      "---\ndescription: x\nmodel: opus\n---\nbody",
    );
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.subagents[0]?.modelHint).toBe("opus");
  });

  test("no front-matter → uses filename + first body line", () => {
    write(
      path.join(workspace, ".claude/agents/bare.md"),
      "This is what I do.\n\nLonger body.",
    );
    const bundle = discoverExtensions(workspace, home);
    const sub = bundle.subagents[0]!;
    expect(sub.name).toBe("bare");
    expect(sub.description).toBe("This is what I do.");
  });

  test("only .md files are considered", () => {
    write(path.join(workspace, ".claude/agents/foo.md"), "---\ndescription: ok\n---\nbody");
    write(path.join(workspace, ".claude/agents/foo.txt"), "ignored");
    write(path.join(workspace, ".claude/agents/foo.json"), "ignored");
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.subagents.length).toBe(1);
  });
});

describe("discoverExtensions — ordering + sorting", () => {
  test("output is alphabetically sorted by name", () => {
    for (const n of ["zebra", "alpha", "middle"]) {
      write(path.join(workspace, `.claude/skills/${n}/SKILL.md`), "---\ndescription: x\n---\n");
      write(path.join(workspace, `.claude/agents/${n}.md`), "---\ndescription: x\n---\nbody");
    }
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills.map((s) => s.name)).toEqual(["alpha", "middle", "zebra"]);
    expect(bundle.subagents.map((s) => s.name)).toEqual(["alpha", "middle", "zebra"]);
  });

  test("no extension dirs anywhere → empty bundle, no crash", () => {
    const bundle = discoverExtensions(workspace, home);
    expect(bundle.skills).toEqual([]);
    expect(bundle.subagents).toEqual([]);
    expect(bundle.shadowedSkills).toEqual([]);
    expect(bundle.shadowedSubagents).toEqual([]);
  });
});
