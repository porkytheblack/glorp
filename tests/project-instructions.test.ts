import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ExtensionsBundle } from "../src/agent/extensions-loader.ts";
import { buildGlorpSystemPrompt } from "../src/agent/persona.ts";
import {
  buildProjectInstructionsContext,
  discoverProjectInstructions,
} from "../src/agent/project-instructions.ts";

let workspace: string;
let home: string;
let realHome: string | undefined;
let realCodexHome: string | undefined;

const emptyExtensions: ExtensionsBundle = {
  skills: [],
  subagents: [],
  shadowedSkills: [],
  shadowedSubagents: [],
};

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function relativeToHome(p: string): string {
  return path.relative(fs.realpathSync(home), fs.realpathSync(p));
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-instr-ws-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-instr-home-"));
  realHome = process.env.HOME;
  realCodexHome = process.env.CODEX_HOME;
  process.env.HOME = home;
  process.env.CODEX_HOME = path.join(home, "codex-profile");
  fs.mkdirSync(path.join(workspace, ".git"));
});

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = realCodexHome;
  for (const dir of [workspace, home]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe("project instruction discovery", () => {
  test("loads AGENTS and CLAUDE files as root-to-cwd instruction context", () => {
    const cwd = path.join(workspace, "packages", "ui");
    fs.mkdirSync(cwd, { recursive: true });
    write(path.join(home, "codex-profile", "AGENTS.md"), "global agents base");
    write(path.join(home, "codex-profile", "AGENTS.override.md"), "global agents override");
    write(path.join(home, ".claude", "CLAUDE.md"), "global claude");
    write(path.join(workspace, "AGENTS.md"), "root agents");
    write(path.join(workspace, "CLAUDE.md"), "root claude");
    write(path.join(workspace, "CLAUDE.local.md"), "root claude local");
    write(path.join(workspace, ".claude", "CLAUDE.md"), "root dot-claude");
    write(path.join(cwd, "AGENTS.md"), "ui agents base");
    write(path.join(cwd, "AGENTS.override.md"), "ui agents override");
    write(path.join(cwd, "CLAUDE.md"), "ui claude <!-- hidden note --> visible");
    write(path.join(cwd, ".claude", "CLAUDE.md"), "ui dot-claude");

    const files = discoverProjectInstructions(cwd, home);
    const labels = files.map((f) => `${f.kind}:${path.relative(fs.realpathSync(home), f.sourcePath)}`);
    expect(labels).toEqual([
      "agents:codex-profile/AGENTS.override.md",
      "claude:.claude/CLAUDE.md",
      `agents:${relativeToHome(path.join(workspace, "AGENTS.md"))}`,
      `claude:${relativeToHome(path.join(workspace, "CLAUDE.md"))}`,
      `claude:${relativeToHome(path.join(workspace, "CLAUDE.local.md"))}`,
      `claude:${relativeToHome(path.join(workspace, ".claude", "CLAUDE.md"))}`,
      `agents:${relativeToHome(path.join(cwd, "AGENTS.override.md"))}`,
      `claude:${relativeToHome(path.join(cwd, "CLAUDE.md"))}`,
      `claude:${relativeToHome(path.join(cwd, ".claude", "CLAUDE.md"))}`,
    ]);
    expect(files.map((f) => f.body).join("\n")).not.toContain("hidden note");
    expect(files.map((f) => f.body).join("\n")).not.toContain("ui agents base");
  });

  test("loads GLORP.md (global and project) with override precedence", () => {
    write(path.join(home, ".glorp", "GLORP.md"), "global glorp base");
    write(path.join(home, ".glorp", "GLORP.override.md"), "global glorp override");
    write(path.join(workspace, "GLORP.md"), "root glorp");
    write(path.join(workspace, "GLORP.override.md"), "root glorp override");
    write(path.join(workspace, "glorp.md"), "root glorp lowercase (should not load — override wins)");

    const files = discoverProjectInstructions(workspace, home);
    const glorpFiles = files.filter((f) => f.kind === "glorp");
    expect(glorpFiles.map((f) => path.basename(f.sourcePath))).toEqual([
      "GLORP.override.md",
      "GLORP.override.md",
    ]);
    expect(glorpFiles[0]!.body).toBe("global glorp override");
    expect(glorpFiles[0]!.scope).toBe("global");
    expect(glorpFiles[1]!.body).toBe("root glorp override");
    expect(glorpFiles[1]!.scope).toBe("project");
  });

  test("loads .cursorrules at every dir from root to cwd", () => {
    const cwd = path.join(workspace, "packages", "api");
    fs.mkdirSync(cwd, { recursive: true });
    write(path.join(workspace, ".cursorrules"), "root cursor rules");
    write(path.join(cwd, ".cursorrules"), "api cursor rules");

    const files = discoverProjectInstructions(cwd, home);
    const cursorFiles = files.filter((f) => f.kind === "cursor");
    const bodies = cursorFiles.map((f) => f.body);
    expect(bodies).toContain("root cursor rules");
    expect(bodies).toContain("api cursor rules");
  });

  test("loads .cursor/rules/*.mdc from the project root in sorted order", () => {
    fs.mkdirSync(path.join(workspace, ".cursor", "rules"), { recursive: true });
    write(path.join(workspace, ".cursor", "rules", "01-style.mdc"), "use 4 spaces");
    write(path.join(workspace, ".cursor", "rules", "02-tests.mdc"), "write tests for new features");
    write(path.join(workspace, ".cursor", "rules", "README.md"), "ignored — not .mdc");

    const files = discoverProjectInstructions(workspace, home);
    const mdcFiles = files
      .filter((f) => f.kind === "cursor" && f.sourcePath.endsWith(".mdc"))
      .map((f) => ({ name: path.basename(f.sourcePath), body: f.body }));
    expect(mdcFiles).toEqual([
      { name: "01-style.mdc", body: "use 4 spaces" },
      { name: "02-tests.mdc", body: "write tests for new features" },
    ]);
    // README.md should NOT be loaded as a cursor rule.
    expect(files.some((f) => f.sourcePath.endsWith("README.md"))).toBe(false);
  });

  test(".cursor/rules/ is only read at the project root, not at every ancestor", () => {
    const cwd = path.join(workspace, "packages", "ui");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(path.join(workspace, ".cursor", "rules"), { recursive: true });
    fs.mkdirSync(path.join(cwd, ".cursor", "rules"), { recursive: true });
    write(path.join(workspace, ".cursor", "rules", "root.mdc"), "root mdc");
    write(path.join(cwd, ".cursor", "rules", "cwd.mdc"), "cwd mdc (should NOT load)");

    const files = discoverProjectInstructions(cwd, home);
    const mdcBodies = files
      .filter((f) => f.sourcePath.endsWith(".mdc"))
      .map((f) => f.body);
    expect(mdcBodies).toEqual(["root mdc"]);
  });

  test("wraps instruction files in a model-visible XML section", () => {
    write(path.join(workspace, "AGENTS.md"), "Run `bun test` after code changes.");
    const context = buildProjectInstructionsContext({
      workspace,
      homeDir: home,
      contextLimit: 20_000,
    });
    expect(context).toContain("<glorp_project_instructions");
    expect(context).toContain("Run `bun test` after code changes.");
    expect(context).toContain("source:");
  });

  test("main system prompt includes project instructions before extensions", () => {
    write(path.join(workspace, "AGENTS.md"), "Use the project instruction marker.");
    const prompt = buildGlorpSystemPrompt({
      workspace,
      contextLimit: 20_000,
      extensions: emptyExtensions,
    });
    const instructionsAt = prompt.indexOf("<glorp_project_instructions");
    const extensionsAt = prompt.indexOf("<glorp_extensions");
    expect(instructionsAt).toBeGreaterThan(-1);
    expect(extensionsAt).toBeGreaterThan(instructionsAt);
    expect(prompt).toContain("Use the project instruction marker.");
  });
});
