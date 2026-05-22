import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { GlorpStore } from "../src/agent/store.ts";
import { createFleet } from "../src/agent/station-bridge.ts";
import { buildGlorp } from "../src/agent/glorp.ts";
import {
  plannerSubAgent,
  researcherSubAgent,
  reviewerSubAgent,
} from "../src/agent/subagents.ts";
import type { ModelAdapter } from "glove-core/core";

// buildGlorp + the agent path expects a provider; sk-test is fine because
// the model is never invoked in these tests.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-test";

const fakeModel: ModelAdapter = {
  name: "fake",
  prompt: async () => ({
    messages: [{ sender: "agent", text: "noop" }],
    tokens_in: 0,
    tokens_out: 0,
  }),
  setSystemPrompt() {},
};

let dataDir: string;
let workspace: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-test-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-test-ws-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {}
});

// =====================================================================
// GlorpStore — file-backed persistence
// =====================================================================
describe("GlorpStore", () => {
  test("persists messages, tasks, inbox, tokens across instances", async () => {
    const sid = "persist-1";
    const store = new GlorpStore(sid, dataDir);
    await store.appendMessages([
      { sender: "user", text: "hello" },
      { sender: "agent", text: "hi friend-shape" },
    ]);
    await store.addTasks([
      { id: "t1", content: "do thing", activeForm: "doing thing", status: "in_progress" },
    ]);
    await store.addInboxItem({
      id: "i1",
      tag: "test",
      request: "remind me",
      response: null,
      status: "pending",
      blocking: false,
      created_at: new Date().toISOString(),
      resolved_at: null,
    });
    await store.addTokens({ tokens_in: 1000, tokens_out: 234 });
    await store.incrementTurn();
    // Wait past the 50ms flush coalesce window.
    await new Promise((r) => setTimeout(r, 250));

    // Fresh instance, same id + dir.
    const reloaded = new GlorpStore(sid, dataDir);
    expect((await reloaded.getMessages()).length).toBe(2);
    expect((await reloaded.getMessages())[0]?.text).toBe("hello");
    expect((await reloaded.getTasks()).length).toBe(1);
    expect((await reloaded.getTasks())[0]?.status).toBe("in_progress");
    expect((await reloaded.getInboxItems()).length).toBe(1);
    expect((await reloaded.getTokenCount())).toBe(1234);
    expect((await reloaded.getTurnCount())).toBe(1);
  });

  test("coalesces back-to-back writes (no race overwrites)", async () => {
    const store = new GlorpStore("coalesce-1", dataDir);
    for (let i = 0; i < 20; i++) {
      await store.appendMessages([{ sender: "user", text: `msg ${i}` }]);
    }
    await new Promise((r) => setTimeout(r, 300));
    const reloaded = new GlorpStore("coalesce-1", dataDir);
    expect((await reloaded.getMessages()).length).toBe(20);
  });

  test("sub-store is isolated by default (durable: false)", async () => {
    const parent = new GlorpStore("parent-1", dataDir);
    const a = await parent.createSubAgentStore("worker", false);
    const b = await parent.createSubAgentStore("worker", false);
    expect(a).not.toBe(b);
  });
});

// =====================================================================
// Fleet — in-process Station executor
// =====================================================================
describe("Fleet (in-process)", () => {
  test("parallel shell-fanout finishes in roughly the same time", async () => {
    const fleet = await createFleet({
      workspace,
      model: fakeModel,
      systemPromptForSubagents: "",
    });
    const resolves: string[] = [];
    fleet.setInboxResolver(async (id) => {
      resolves.push(id);
    });
    await fleet.start();
    const t0 = Date.now();
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((id) =>
        fleet.dispatch("shell-fanout", {
          itemId: id,
          tag: "parallel",
          payload: "sleep 0.3 && echo done",
        }),
      ),
    );
    while (resolves.length < 5 && Date.now() - t0 < 4000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    const elapsed = Date.now() - t0;
    expect(resolves.length).toBe(5);
    // Serial would be ~1500ms; parallel should be ~350-700ms.
    expect(elapsed).toBeLessThan(1200);
    await fleet.stop();
  }, 8_000);

  test("concurrency limiter caps in-flight to MAX_CONCURRENT (=6)", async () => {
    const fleet = await createFleet({
      workspace,
      model: fakeModel,
      systemPromptForSubagents: "",
    });
    const resolves: string[] = [];
    fleet.setInboxResolver(async (id) => {
      resolves.push(id);
    });
    await fleet.start();
    const t0 = Date.now();
    const ids = Array.from({ length: 10 }, (_, i) => `j${i}`);
    await Promise.all(
      ids.map((id) =>
        fleet.dispatch("shell-fanout", {
          itemId: id,
          tag: "limit",
          payload: "sleep 0.3 && echo ok",
        }),
      ),
    );
    while (resolves.length < 10 && Date.now() - t0 < 6000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    const elapsed = Date.now() - t0;
    expect(resolves.length).toBe(10);
    // With limit 6, 10 jobs of ~300ms each run in 2 batches → ~600ms+.
    // Without the limit they'd all run in ~300-400ms.
    expect(elapsed).toBeGreaterThan(500);
    await fleet.stop();
  }, 10_000);

  test("failing job is reported with status='error' to the resolver", async () => {
    const fleet = await createFleet({
      workspace,
      model: fakeModel,
      systemPromptForSubagents: "",
    });
    let captured: { id: string; status: "resolved" | "error" } | null = null;
    fleet.setInboxResolver(async (id, _resp, status) => {
      captured = { id, status };
    });
    await fleet.start();
    await fleet.dispatch("shell-fanout", {
      itemId: "fail1",
      tag: "errpath",
      payload: "exit 7",
    });
    const t0 = Date.now();
    while (!captured && Date.now() - t0 < 3000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(captured).not.toBeNull();
    expect(captured!.status).toBe("error");
    await fleet.stop();
  }, 6_000);

  test("stop() kills active children promptly (no orphans, no hang)", async () => {
    const fleet = await createFleet({
      workspace,
      model: fakeModel,
      systemPromptForSubagents: "",
    });
    await fleet.start();
    await fleet.dispatch("shell-fanout", {
      itemId: "longjob",
      tag: "stop",
      payload: "sleep 5",
    });
    // Give it a beat to actually spawn.
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await fleet.stop();
    const elapsed = Date.now() - t0;
    // Should kill the 5s sleep within a couple of seconds.
    expect(elapsed).toBeLessThan(2500);
  }, 8_000);

  test("shell-fanout refuses destructive patterns (no fleet-side bypass of bash safety)", async () => {
    const fleet = await createFleet({
      workspace,
      model: fakeModel,
      systemPromptForSubagents: "",
    });
    let captured: { resp: string; status: "resolved" | "error" } | null = null;
    fleet.setInboxResolver(async (_id, resp, status) => {
      captured = { resp, status };
    });
    await fleet.start();
    await fleet.dispatch("shell-fanout", {
      itemId: "danger",
      tag: "danger",
      payload: "rm -rf /",
    });
    const t0 = Date.now();
    while (!captured && Date.now() - t0 < 2000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(captured).not.toBeNull();
    expect(captured!.status).toBe("error");
    expect(captured!.resp).toMatch(/destructive pattern/);
    await fleet.stop();
  }, 5_000);

  test("shell-fanout does not leak API key env vars to child processes", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-leak-test";
    const fleet = await createFleet({
      workspace,
      model: fakeModel,
      systemPromptForSubagents: "",
    });
    let captured: string | null = null;
    fleet.setInboxResolver(async (_id, resp) => {
      captured = resp;
    });
    await fleet.start();
    await fleet.dispatch("shell-fanout", {
      itemId: "env-leak",
      tag: "env",
      payload: 'echo "key=${ANTHROPIC_API_KEY:-unset}"',
    });
    const t0 = Date.now();
    while (!captured && Date.now() - t0 < 2000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(captured).not.toBeNull();
    expect(captured!).toContain("key=unset");
    expect(captured!).not.toContain("sk-leak-test");
    await fleet.stop();
  }, 5_000);

  test("invalid input throws synchronously and doesn't leak a slot", async () => {
    const fleet = await createFleet({
      workspace,
      model: fakeModel,
      systemPromptForSubagents: "",
    });
    await fleet.start();
    await expect(
      fleet.dispatch("shell-fanout", { itemId: 1 as any, tag: "x", payload: "y" }),
    ).rejects.toThrow(/Invalid input/);
    // Slot should not be held — a follow-up dispatch must work.
    let resolved = false;
    fleet.setInboxResolver(async () => {
      resolved = true;
    });
    await fleet.dispatch("shell-fanout", {
      itemId: "ok1",
      tag: "x",
      payload: "echo ok",
    });
    const t0 = Date.now();
    while (!resolved && Date.now() - t0 < 2000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(resolved).toBe(true);
    await fleet.stop();
  }, 5_000);
});

// =====================================================================
// Subagent factories
// =====================================================================
describe("Subagent factories", () => {
  // The factory ctx requires AgentControls. We hand it a minimal stub —
  // the factory only reads parentStore + parentControls.glove.model +
  // parentControls.displayManager during construction.
  const buildCtx = (parentStore: any) => ({
    name: "x",
    prompt: "test",
    parentStore,
    parentControls: {
      glove: { model: fakeModel },
      displayManager: {},
    } as any,
  });

  test("plannerSubAgent factory builds without throwing", async () => {
    const parentStore = new GlorpStore("p1", dataDir);
    const subagent = plannerSubAgent({ workspace });
    const child = await subagent.factory(buildCtx(parentStore));
    expect(typeof child.processRequest).toBe("function");
  });

  test("researcherSubAgent factory builds", async () => {
    const parentStore = new GlorpStore("r1", dataDir);
    const subagent = researcherSubAgent({ workspace });
    const child = await subagent.factory(buildCtx(parentStore));
    expect(typeof child.processRequest).toBe("function");
  });

  test("reviewerSubAgent factory builds", async () => {
    const parentStore = new GlorpStore("rv1", dataDir);
    const subagent = reviewerSubAgent({ workspace });
    const child = await subagent.factory(buildCtx(parentStore));
    expect(typeof child.processRequest).toBe("function");
  });
});

// =====================================================================
// buildGlorp — agent wiring
// =====================================================================
describe("buildGlorp", () => {
  test("registers the full tool set including task + inbox", async () => {
    const g = await buildGlorp({
      workspace,
      sessionId: "wire-1",
      dataDir,
    });
    try {
      const tools = (g.agent as any).executor.tools as Array<{ name: string }>;
      const names = tools.map((t) => t.name).sort();
      const required = [
        "bash",
        "dispatch_fleet",
        "edit",
        "glob",
        "glove_invoke_skill",
        "glove_invoke_subagent",
        "glove_post_to_inbox",
        "glove_update_tasks",
        "grep",
        "ls",
        "read",
        "transmission",
        "web_fetch",
        "write",
      ];
      for (const name of required) {
        expect(names).toContain(name);
      }
    } finally {
      await g.shutdown();
    }
  });

  test("shutdown is clean and idempotent", async () => {
    const g = await buildGlorp({ workspace, sessionId: "shutdown-1", dataDir });
    await g.shutdown();
    // Second shutdown should not throw.
    await g.shutdown();
  });
});
