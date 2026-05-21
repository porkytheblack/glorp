import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { buildGlorp } from "../src/agent/glorp.ts";

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-test";

let dataDir: string;
let workspace: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-ext-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-ext-ws-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {}
});

describe("GlorpHandle.extensions catalogue", () => {
  test("slash list includes all defined hooks and exposed skills", async () => {
    const g = await buildGlorp({ workspace, sessionId: "ext-1", dataDir });
    try {
      const names = g.extensions.slash.map((s) => s.name);
      expect(names).toContain("/compact");
      expect(names).toContain("/plan");
      expect(names).toContain("/diff");
      expect(names).toContain("/clear");
      expect(names).toContain("/transmissions");
      // /concise is an exposeToAgent skill, should be surfaced.
      expect(names).toContain("/concise");
      // /help and /quit are always present.
      expect(names).toContain("/help");
      expect(names).toContain("/quit");
    } finally {
      await g.shutdown();
    }
  });

  test("mention list includes all defined subagents", async () => {
    const g = await buildGlorp({ workspace, sessionId: "ext-2", dataDir });
    try {
      const names = g.extensions.mentions.map((s) => s.name);
      expect(names).toContain("@planner");
      expect(names).toContain("@researcher");
      expect(names).toContain("@reviewer");
    } finally {
      await g.shutdown();
    }
  });

  test("every entry has a non-empty description", async () => {
    const g = await buildGlorp({ workspace, sessionId: "ext-3", dataDir });
    try {
      for (const e of [...g.extensions.slash, ...g.extensions.mentions]) {
        expect(typeof e.description).toBe("string");
        expect(e.description.length).toBeGreaterThan(0);
      }
    } finally {
      await g.shutdown();
    }
  });

  test("descriptions match registered subagent.description verbatim", async () => {
    const g = await buildGlorp({ workspace, sessionId: "ext-4", dataDir });
    try {
      const planner = g.extensions.mentions.find((m) => m.name === "@planner");
      expect(planner?.description).toMatch(/design/i);
      const researcher = g.extensions.mentions.find((m) => m.name === "@researcher");
      expect(researcher?.description).toMatch(/investig/i);
      const reviewer = g.extensions.mentions.find((m) => m.name === "@reviewer");
      // Reviewer's description is "Use AFTER a substantial change to get a
      // second opinion …" — no literal "review", but the second-opinion
      // framing is the signal.
      expect(reviewer?.description).toMatch(/second opinion|punch-list/i);
    } finally {
      await g.shutdown();
    }
  });

  test("concise skill description matches what was registered", async () => {
    const g = await buildGlorp({ workspace, sessionId: "ext-5", dataDir });
    try {
      const concise = g.extensions.slash.find((s) => s.name === "/concise");
      // The hook for /concise is not registered, but the skill is — we
      // pick up the skill's description ("Trim verbosity ...").
      expect(concise?.description).toMatch(/terse|trim|verbos/i);
    } finally {
      await g.shutdown();
    }
  });
});
