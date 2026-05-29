/**
 * Regression guard for "Tool registry missing store": every built-in role's
 * tool set must register cleanly against the dependencies the subprocess
 * factory provides (workspace + dataDir + the agent's own store). The generator
 * role uniquely includes the plan tool, which needs a store — previously the
 * subprocess factory omitted it and the generator subprocess crashed.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ROLE_DEFS } from "../../src/orchestrator/role-registry.ts";
import { createToolRegistry, registerTools } from "../../src/agent/tools/registry.ts";
import { GlorpStore } from "../../src/agent/store.ts";

let dataDir: string;
let workspace: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-roletools-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-roletools-ws-"));
});
afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
});

// Minimal Glove stand-in: registerTools only calls `.fold(args)`.
const fakeGlove = { fold() { return fakeGlove; } } as any;

describe("subprocess role tool registration", () => {
  test("every built-in role registers its tools with subprocess deps (store included)", () => {
    const store = new GlorpStore("roletools", dataDir);
    const registry = createToolRegistry({ workspace, dataDir, store });
    for (const [role, def] of Object.entries(ROLE_DEFS)) {
      expect(() => registerTools(fakeGlove, registry, def.tools), `role ${role}`).not.toThrow();
    }
  });

  test("the generator's plan tool is exactly what needs a store (reproduces the bug)", () => {
    const noStore = createToolRegistry({ workspace, dataDir }); // store intentionally omitted
    // generator includes glorp_update_plan → must throw without a store
    expect(() => registerTools(fakeGlove, noStore, ROLE_DEFS.generator!.tools)).toThrow(/missing store/);
    // builder / evaluator / researcher have no plan tool → fine without a store
    for (const role of ["builder", "evaluator", "researcher"]) {
      expect(() => registerTools(fakeGlove, noStore, ROLE_DEFS[role]!.tools), `role ${role}`).not.toThrow();
    }
  });
});
