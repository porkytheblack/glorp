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
