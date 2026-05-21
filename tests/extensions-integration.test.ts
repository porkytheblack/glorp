import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { buildGlorp } from "../src/agent/glorp.ts";

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-test";

let workspace: string;
let dataDir: string;
let realHome: string | undefined;
let homeOverride: string;

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-int-ws-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-int-data-"));
  // Discovery falls back to os.homedir() when no override is plumbed
  // through, so neuter it for the test by pointing HOME at an empty dir.
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-int-home-"));
  realHome = process.env.HOME;
  process.env.HOME = homeOverride;
});

afterEach(() => {
  if (realHome !== undefined) process.env.HOME = realHome;
  else delete process.env.HOME;
  for (const d of [workspace, dataDir, homeOverride]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});

describe("disk-loaded skills register on the agent", () => {
  test("loaded skill surfaces in extensions.slash and as a registered skill", async () => {
    write(
      path.join(workspace, ".claude/skills/python-pro/SKILL.md"),
      "---\ndescription: Expert Python coding skill\n---\n# Python\n\nWrite idiomatic Python.",
    );
    const g = await buildGlorp({ workspace, sessionId: "ext-int-1", dataDir });
    try {
      const slash = g.extensions.slash.map((s) => s.name);
      expect(slash).toContain("/python-pro");
      const py = g.extensions.slash.find((s) => s.name === "/python-pro");
      expect(py?.description).toBe("Expert Python coding skill");

      const skills = (g.agent as any).skills as Map<string, { description?: string; exposeToAgent?: boolean }>;
      const reg = skills.get("python-pro");
      expect(reg).toBeDefined();
      expect(reg?.exposeToAgent).toBe(true);
    } finally {
      await g.shutdown();
    }
  });

  test("invoking the skill returns the SKILL.md body", async () => {
    write(
      path.join(workspace, ".claude/skills/quick/SKILL.md"),
      "---\ndescription: short\n---\nbody-content-marker",
    );
    const g = await buildGlorp({ workspace, sessionId: "ext-int-2", dataDir });
    try {
      const skills = (g.agent as any).skills as Map<
        string,
        { handler: (ctx: unknown) => Promise<string> }
      >;
      const reg = skills.get("quick");
      expect(reg).toBeDefined();
      const result = (await reg!.handler({
        name: "quick",
        parsedText: "",
        source: "agent",
        controls: {} as never,
      })) as string;
      expect(result).toContain("body-content-marker");
    } finally {
      await g.shutdown();
    }
  });

  test("reference files are mentioned in the injected payload", async () => {
    write(
      path.join(workspace, ".claude/skills/multi/SKILL.md"),
      "---\ndescription: multi-file skill\n---\nmain-body",
    );
    write(path.join(workspace, ".claude/skills/multi/api.md"), "api ref");
    const g = await buildGlorp({ workspace, sessionId: "ext-int-3", dataDir });
    try {
      const skills = (g.agent as any).skills as Map<
        string,
        { handler: (ctx: unknown) => Promise<string> }
      >;
      const out = (await skills.get("multi")!.handler({
        name: "multi",
        parsedText: "",
        source: "agent",
        controls: {} as never,
      })) as string;
      expect(out).toContain("main-body");
      expect(out).toContain("Reference files");
      expect(out).toContain("api.md");
    } finally {
      await g.shutdown();
    }
  });
});

describe("disk-loaded subagents register on the agent", () => {
  test("loaded subagent surfaces in extensions.mentions", async () => {
    write(
      path.join(workspace, ".claude/agents/security-auditor.md"),
      "---\ndescription: Audits code for vulnerabilities\ntools: Read, Grep, Glob\n---\nYou audit code.",
    );
    const g = await buildGlorp({ workspace, sessionId: "ext-int-4", dataDir });
    try {
      const mentions = g.extensions.mentions.map((s) => s.name);
      expect(mentions).toContain("@security-auditor");

      const subAgents = (g.agent as any).subAgents as Map<string, { description?: string }>;
      const reg = subAgents.get("security-auditor");
      expect(reg).toBeDefined();
      expect(reg?.description).toBe("Audits code for vulnerabilities");
    } finally {
      await g.shutdown();
    }
  });

  test("subagent factory builds a child Glove with the body as systemPrompt", async () => {
    write(
      path.join(workspace, ".claude/agents/poet.md"),
      "---\ndescription: Writes haiku\n---\nYou are a haiku poet. Output only haiku.",
    );
    const g = await buildGlorp({ workspace, sessionId: "ext-int-5", dataDir });
    try {
      const subAgents = (g.agent as any).subAgents as Map<
        string,
        { factory: (ctx: any) => Promise<{ getSystemPrompt: () => string }> }
      >;
      const factory = subAgents.get("poet")?.factory;
      expect(factory).toBeDefined();
      // Provide the minimum controls the factory consults.
      const child = await factory!({
        name: "poet",
        prompt: "test",
        parentStore: g.store,
        parentControls: {
          glove: { model: g.agent.model },
          displayManager: g.agent.displayManager,
        } as never,
      });
      expect(child.getSystemPrompt()).toContain("haiku");
    } finally {
      await g.shutdown();
    }
  });

  test("user subagents coexist with built-in subagents (planner/researcher/reviewer)", async () => {
    write(
      path.join(workspace, ".claude/agents/mine.md"),
      "---\ndescription: my subagent\n---\nDo my thing.",
    );
    const g = await buildGlorp({ workspace, sessionId: "ext-int-6", dataDir });
    try {
      const names = g.extensions.mentions.map((m) => m.name);
      // Built-ins still present.
      expect(names).toContain("@planner");
      expect(names).toContain("@researcher");
      expect(names).toContain("@reviewer");
      // And the user-defined one.
      expect(names).toContain("@mine");
    } finally {
      await g.shutdown();
    }
  });
});

describe("disk extensions — dedupe across .claude / .agents", () => {
  test("user can keep files in both folders without double-registration", async () => {
    write(
      path.join(workspace, ".claude/skills/dup/SKILL.md"),
      "---\ndescription: from .claude\n---\nclaude-body",
    );
    write(
      path.join(workspace, ".agents/skills/dup/SKILL.md"),
      "---\ndescription: from .agents\n---\nagents-body",
    );
    const g = await buildGlorp({ workspace, sessionId: "ext-int-7", dataDir });
    try {
      const matches = g.extensions.slash.filter((s) => s.name === "/dup");
      expect(matches.length).toBe(1);
      // .claude wins.
      expect(matches[0]?.description).toBe("from .claude");
    } finally {
      await g.shutdown();
    }
  });
});
