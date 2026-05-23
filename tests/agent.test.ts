import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";

import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import { GlorpStore } from "../src/agent/store.ts";
import { createFleet } from "../src/agent/station-bridge.ts";
import {
  buildGlorp,
  cleanSessionTitle,
  generateSessionTitle,
  messageHasOpenTaskUpdate,
  modelResultIsIntentOnly,
  modelResultHasVisibleAgentOutput,
  modelResultHasToolCall,
  withEmptyResponseRetry,
  withIntentOnlyContinuation,
  withTaskUpdateContinuation,
} from "../src/agent/glorp.ts";
import { getBridge } from "../src/shared/bridge.ts";
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
    await store.setTitle("Friendly login repair");
    // Wait past the 50ms flush coalesce window.
    await store.flush();

    // Fresh instance, same id + dir.
    const reloaded = new GlorpStore(sid, dataDir);
    expect(await reloaded.getTitle()).toBe("Friendly login repair");
    const modelMessages = await reloaded.getMessages();
    expect(modelMessages.length).toBe(3);
    expect(modelMessages[0]?.is_skill_injection).toBe(true);
    expect(modelMessages[1]?.text).toBe("hello");
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

  test("subagent stores persist under the parent session with trigger metadata", async () => {
    const parent = new GlorpStore("parent-2", dataDir);
    await parent.appendMessages([{ sender: "user", id: "u1", text: "review the auth flow" }]);
    const child = await parent.createSubAgentStore("reviewer", false);
    await child.appendMessages([{ sender: "agent", text: "auth review notes" }]);
    await new Promise((r) => setTimeout(r, 180));

    const dir = path.join(dataDir, "sessions", "parent-2.subagents", "reviewer");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, files[0]!), "utf-8"));
    expect(snap.metadata.kind).toBe("subagent");
    expect(snap.metadata.parentSessionId).toBe("parent-2");
    expect(snap.metadata.triggerMessageId).toBe("u1");
    expect(snap.metadata.triggerMessageText).toBe("review the auth flow");
    expect(snap.messages[0].text).toBe("auth review notes");
  });

  test("task updates replace the stored plan instead of appending duplicates", async () => {
    const store = new GlorpStore("plans-1", dataDir);
    await store.addTasks([
      { id: "a", content: "Inspect issue", activeForm: "Inspecting issue", status: "completed" },
    ]);
    await store.addTasks([
      { id: "b", content: "Run tests", activeForm: "Running tests", status: "in_progress" },
    ]);
    const tasks = await store.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.content).toBe("Run tests");
    await new Promise((r) => setTimeout(r, 120));
  });

  test("plan document persists separately from task artifacts", async () => {
    const store = new GlorpStore("plan-doc-1", dataDir);
    await store.updatePlan({
      title: "Auth refactor",
      body: "Methodology: inspect boundaries, update handlers, then verify auth tests.",
    });
    await store.addTasks([
      { id: "t1", content: "Run auth tests", activeForm: "Running auth tests", status: "pending" },
    ]);
    await new Promise((r) => setTimeout(r, 180));
    const reloaded = new GlorpStore("plan-doc-1", dataDir);
    expect((await reloaded.getPlan())?.title).toBe("Auth refactor");
    expect((await reloaded.getTasks())[0]?.content).toBe("Run auth tests");
  });
});

describe("Glove tool continuation", () => {
  test("continues after a tool result and returns the final model response", async () => {
    let calls = 0;
    const model: ModelAdapter = {
      name: "tool-then-final",
      setSystemPrompt() {},
      prompt: async (request, notify) => {
        calls++;
        if (calls === 1) {
          const toolCall = {
            id: "call_1",
            tool_name: "echo_once",
            input_args: { text: "hi" },
          };
          await notify("tool_use", { id: "call_1", name: "echo_once", input: { text: "hi" } });
          await notify("model_response_complete", {
            text: "",
            tool_calls: [toolCall],
            stop_reason: "tool_use",
            tokens_in: 1,
            tokens_out: 1,
          });
          return { messages: [{ sender: "agent", text: "", tool_calls: [toolCall] }], tokens_in: 1, tokens_out: 1 };
        }
        const result = request.messages.at(-1)?.tool_results?.[0]?.result.data;
        expect(result).toBe("echo: hi");
        await notify("model_response_complete", {
          text: "done",
          stop_reason: "end_turn",
          tokens_in: 1,
          tokens_out: 1,
        });
        return { messages: [{ sender: "agent", text: "done" }], tokens_in: 1, tokens_out: 1 };
      },
    };

    const store = new GlorpStore("continue-1", dataDir);
    const agent = new Glove({
      store,
      model,
      displayManager: new Displaymanager(),
      serverMode: true,
      systemPrompt: "test",
      compaction_config: { compaction_instructions: "compact", max_turns: 10 },
    })
      .fold({
        name: "echo_once",
        description: "Echo a short string.",
        inputSchema: z.object({ text: z.string().describe("Text to echo") }),
        async do(input) {
          return { status: "success", data: `echo: ${input.text}` };
        },
      })
      .build();

    const response = await agent.processRequest("use the tool");
    expect(calls).toBe(2);
    expect(JSON.stringify(response)).toContain("done");
    expect((await store.getMessages()).some((m) => m.tool_results?.length)).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
  });
});

// =====================================================================
// Fleet — Station child-process executor
// =====================================================================
describe("Fleet (Station child processes)", () => {
  test("parallel shell-fanout beats serial wall-clock despite child startup", async () => {
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
          payload: "sleep 1 && echo done",
        }),
      ),
    );
    while (resolves.length < 5 && Date.now() - t0 < 7000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    const elapsed = Date.now() - t0;
    expect(resolves.length).toBe(5);
    // Serial sleep time alone is ~5000ms; Station child startup adds overhead
    // but the work should still complete as a parallel batch.
    expect(elapsed).toBeLessThan(5000);
    await fleet.stop();
  }, 9_000);

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
      const tools = (g.agent as any).executor.tools as Array<{ name: string; description?: string; run?: Function }>;
      expect((g.agent as any).promptMachine.enableToolResultSummary).toBe(true);
      const names = tools.map((t) => t.name).sort();
      const required = [
        "apply_patch",
        "bash",
        "dispatch_fleet",
        "edit",
        "glob",
        "glove_invoke_skill",
        "glove_invoke_subagent",
        "glove_post_to_inbox",
        "glove_update_inbox",
        "glove_update_tasks",
        "glorp_update_plan",
        "glove_resources_edit",
        "glove_resources_glob",
        "glove_resources_grep",
        "glove_resources_links_for",
        "glove_resources_ls",
        "glove_resources_mkdir",
        "glove_resources_move",
        "glove_resources_read",
        "glove_resources_remove",
        "glove_resources_set_metadata",
        "glove_resources_stat",
        "glove_resources_write",
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
      const taskTool = tools.find((t) => t.name === "glove_update_tasks");
      expect(taskTool?.description).toContain("bookkeeping only");
      const result = await taskTool?.run?.({
        todos: [{ content: "Inspect", activeForm: "Inspecting", status: "in_progress" }],
      });
      expect(JSON.stringify(result?.data)).toContain("continue immediately");
      await g.store.addInboxItem({
        id: "block-1",
        tag: "fleet:research:test",
        request: "Fetch docs that are no longer required",
        response: null,
        status: "pending",
        blocking: true,
        created_at: new Date().toISOString(),
        resolved_at: null,
      });
      const inboxTool = tools.find((t) => t.name === "glove_update_inbox");
      const inboxResult = await inboxTool?.run?.({
        item_ids: ["block-1"],
        reason: "Direct web_fetch results already supplied the needed docs.",
      });
      expect(inboxResult?.status).toBe("success");
      const consumed = (await g.store.getInboxItems()).find((item) => item.id === "block-1");
      expect(consumed?.status).toBe("consumed");
      expect(consumed?.blocking).toBe(true);
      expect(consumed?.response).toContain("Direct web_fetch");
      await g.store.addInboxItem({
        id: "hidden-id-1",
        tag: "fleet_check",
        request: "Visible tag only blocker",
        response: null,
        status: "pending",
        blocking: true,
        created_at: new Date().toISOString(),
        resolved_at: null,
      });
      const tagResult = await inboxTool?.run?.({
        tags: ["fleet_check"],
        reason: "The visible fleet_check blocker is obsolete.",
      });
      expect(tagResult?.status).toBe("success");
      expect(JSON.stringify(tagResult?.data)).toContain("hidden-id-1");
      expect(JSON.stringify(tagResult?.data)).toContain("fleet_check");
      const tagConsumed = (await g.store.getInboxItems()).find((item) => item.id === "hidden-id-1");
      expect(tagConsumed?.status).toBe("consumed");
      expect(tagConsumed?.response).toContain("fleet_check blocker");
      const repeatedTagResult = await inboxTool?.run?.({
        tags: ["fleet_check"],
        reason: "The visible fleet_check blocker is still obsolete.",
      });
      expect(repeatedTagResult?.status).toBe("success");
      expect(JSON.stringify(repeatedTagResult?.data)).toContain("already_consumed");
      expect(JSON.stringify(repeatedTagResult?.data)).not.toContain('"missing_tags":["fleet_check"]');
      await g.store.addInboxItem({
        id: "hidden-id-2",
        tag: "second_visible_tag",
        request: "Visible tag passed in the wrong schema field",
        response: null,
        status: "pending",
        blocking: true,
        created_at: new Date().toISOString(),
        resolved_at: null,
      });
      const tagInIdFieldResult = await inboxTool?.run?.({
        item_ids: ["second_visible_tag"],
        reason: "The model passed a visible tag in item_ids.",
      });
      expect(tagInIdFieldResult?.status).toBe("success");
      const secondConsumed = (await g.store.getInboxItems()).find((item) => item.id === "hidden-id-2");
      expect(secondConsumed?.status).toBe("consumed");
    } finally {
      await g.shutdown();
    }
  });

  test("hydrateUi replays persisted visible messages and title after resume", async () => {
    const seed = new GlorpStore("resume-1", dataDir);
    await seed.appendMessages([
      { id: "u1", sender: "user", text: "fix auth resume" },
      { id: "a1", sender: "agent", text: "I'll inspect it." },
      { id: "c1", sender: "agent", text: "summary internals", is_compaction: true },
      { id: "s1", sender: "user", text: "skill payload", is_skill_injection: true },
      {
        id: "tr1",
        sender: "user",
        text: "tool result internals",
        tool_results: [{ call_id: "x", tool_name: "read", result: { status: "success", data: "ok" } }],
      } as any,
    ]);
    await seed.setTitle("Auth resume repair");
    await seed.flush();

    const g = await buildGlorp({ workspace, sessionId: "resume-1", dataDir });
    const events: any[] = [];
    const unsub = getBridge().subscribe((event) => events.push(event));
    try {
      await g.hydrateUi();
      const hydrated = events.find((event) => event.type === "session_hydrate");
      expect(hydrated).toBeDefined();
      expect(hydrated.title).toBe("Auth resume repair");
      expect(hydrated.turns.map((t: any) => t.text)).toEqual([
        "fix auth resume",
        "I'll inspect it.",
      ]);
    } finally {
      unsub();
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

describe("session title generation", () => {
  test("cleans model-produced title text", () => {
    expect(cleanSessionTitle('Title: "Fix Login Resume."')).toBe("Fix Login Resume");
  });

  test("generates a title from visible transcript messages", async () => {
    const calls: any[] = [];
    const titleModel: ModelAdapter = {
      name: "title-model",
      async prompt(request) {
        calls.push(request);
        return {
          messages: [{ sender: "agent", text: "Title: Resume Transcript Loading." }],
          tokens_in: 10,
          tokens_out: 4,
        };
      },
      setSystemPrompt() {},
    };

    const title = await generateSessionTitle(titleModel, [
      { sender: "user", text: "previous chat messages do not load" },
      { sender: "agent", text: "I'll inspect the store adapter." },
      { sender: "agent", text: "compaction summary", is_compaction: true },
    ]);
    expect(title).toBe("Resume Transcript Loading");
    expect(calls[0].messages[0].text).toContain("User: previous chat messages do not load");
    expect(calls[0].messages[0].text).not.toContain("compaction summary");
  });
});

describe("model empty-response guard", () => {
  test("detects visible agent text or tool calls", () => {
    expect(
      modelResultHasVisibleAgentOutput({
        messages: [{ sender: "agent", text: "done" }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
    expect(
      modelResultHasVisibleAgentOutput({
        messages: [{ sender: "agent", text: "", tool_calls: [{ tool_name: "read", input_args: {} }] }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
    expect(
      modelResultHasVisibleAgentOutput({
        messages: [{ sender: "agent", text: "", reasoning_content: "thinking only" }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(false);
    expect(
      modelResultHasToolCall({
        messages: [{ sender: "agent", text: "", tool_calls: [{ tool_name: "read", input_args: {} }] }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
  });

  test("detects intent-only agent text", () => {
    expect(
      modelResultIsIntentOnly({
        messages: [{ sender: "agent", text: "I'll inspect the relevant files now." }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
    expect(
      modelResultIsIntentOnly({
        messages: [{ sender: "agent", text: "Let me run the tests next." }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
    expect(
      modelResultIsIntentOnly({
        messages: [
          {
            sender: "agent",
            text: "Based on the session summary, all content is gathered. Now I'll rewrite the script to incorporate all pages.",
          },
        ],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
    expect(
      modelResultIsIntentOnly({
        messages: [
          {
            sender: "agent",
            text: "Proceeding. The fleet jobs failed, but the direct web_fetch content is available. Writing the comprehensive docx generator now.",
          },
        ],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
    expect(
      modelResultIsIntentOnly({
        messages: [
          {
            sender: "agent",
            text: "The blocking inbox item is not required for this path. I can proceed with the script rewrite.",
          },
        ],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(true);
    expect(
      modelResultIsIntentOnly({
        messages: [{ sender: "agent", text: "The issue is fixed and tests pass." }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(false);
    expect(
      modelResultIsIntentOnly({
        messages: [{ sender: "agent", text: "I'll inspect.", tool_calls: [{ tool_name: "read", input_args: {} }] }],
        tokens_in: 0,
        tokens_out: 0,
      }),
    ).toBe(false);
  });

  test("retries an invisible reasoning-only completion once", async () => {
    const seenRequests: any[] = [];
    const model: ModelAdapter = {
      name: "empty-first",
      async prompt(request) {
        seenRequests.push(request);
        if (seenRequests.length === 1) {
          return {
            messages: [{ sender: "agent", text: "", reasoning_content: "thinking only" }],
            tokens_in: 10,
            tokens_out: 4096,
          };
        }
        return {
          messages: [{ sender: "agent", text: "visible answer" }],
          tokens_in: 11,
          tokens_out: 3,
        };
      },
      setSystemPrompt() {},
    };

    const guarded = withEmptyResponseRetry(model);
    const result = await guarded.prompt(
      { messages: [{ sender: "user", text: "do the thing" }] },
      async () => {},
    );

    expect(seenRequests.length).toBe(2);
    expect(seenRequests[1].messages.at(-1)?.text).toContain("no visible answer");
    expect(result.messages.at(-1)?.text).toBe("visible answer");
  });

  test("retries intent-only text generally without emitting it", async () => {
    const seenRequests: any[] = [];
    const emitted: string[] = [];
    const model: ModelAdapter = {
      name: "intent-only-first",
      async prompt(request, notify) {
        seenRequests.push(request);
        if (seenRequests.length === 1) {
          await notify("model_response" as any, { text: "I'll inspect the files now." } as any);
          return {
            messages: [{ sender: "agent", text: "I'll inspect the files now." }],
            tokens_in: 10,
            tokens_out: 6,
          };
        }
        await notify("tool_use" as any, { id: "tc1", name: "read", input: { file: "src/app.ts" } } as any);
        return {
          messages: [
            {
              sender: "agent",
              text: "",
              tool_calls: [{ id: "tc1", tool_name: "read", input_args: { file: "src/app.ts" } }],
            },
          ],
          tokens_in: 11,
          tokens_out: 3,
        };
      },
      setSystemPrompt() {},
    };

    const guarded = withIntentOnlyContinuation(model);
    const result = await guarded.prompt(
      { messages: [{ sender: "user", text: "fix this bug" }] },
      async (event, data) => {
        if (event === "model_response") emitted.push((data as { text?: string }).text ?? "");
        if (event === "tool_use") emitted.push(`tool:${(data as { name?: string }).name}`);
      },
    );

    expect(seenRequests.length).toBe(2);
    expect(seenRequests[1].messages.at(-1)?.text).toContain("only stated an intention");
    expect(emitted).toEqual(["tool:read"]);
    expect(result.messages.at(-1)?.tool_calls?.[0]?.tool_name).toBe("read");
  });

  test("detects task updates with unfinished work", () => {
    expect(
      messageHasOpenTaskUpdate({
        sender: "user",
        text: "tool results",
        tool_results: [
          {
            tool_name: "glove_update_tasks",
            result: {
              status: "success",
              data: {
                tasks: [
                  { id: "t1", content: "Inspect", activeForm: "Inspecting", status: "completed" },
                  { id: "t2", content: "Patch", activeForm: "Patching", status: "in_progress" },
                ],
              },
            },
          },
        ],
      }),
    ).toBe(true);

    expect(
      messageHasOpenTaskUpdate({
        sender: "user",
        text: "tool results",
        tool_results: [
          {
            tool_name: "glove_update_tasks",
            result: {
              status: "success",
              data: {
                tasks: [
                  { id: "t1", content: "Inspect", activeForm: "Inspecting", status: "completed" },
                ],
              },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  test("retries intent-only text after an open task update without emitting it", async () => {
    const seenRequests: any[] = [];
    const emitted: string[] = [];
    const model: ModelAdapter = {
      name: "task-stop-first",
      async prompt(request, notify) {
        seenRequests.push(request);
        if (seenRequests.length === 1) {
          await notify("model_response" as any, { text: "I'll start editing now." } as any);
          return {
            messages: [{ sender: "agent", text: "I'll start editing now." }],
            tokens_in: 10,
            tokens_out: 6,
          };
        }
        await notify("tool_use" as any, { id: "tc1", name: "read", input: { file: "src/app.ts" } } as any);
        return {
          messages: [
            {
              sender: "agent",
              text: "",
              tool_calls: [{ id: "tc1", tool_name: "read", input_args: { file: "src/app.ts" } }],
            },
          ],
          tokens_in: 11,
          tokens_out: 3,
        };
      },
      setSystemPrompt() {},
    };

    const guarded = withTaskUpdateContinuation(model);
    const result = await guarded.prompt(
      {
        messages: [
          {
            sender: "user",
            text: "tool results",
            tool_results: [
              {
                tool_name: "glove_update_tasks",
                result: {
                  status: "success",
                  data: {
                    tasks: [
                      { id: "t1", content: "Edit file", activeForm: "Editing file", status: "in_progress" },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      async (event, data) => {
        if (event === "model_response") emitted.push((data as { text?: string }).text ?? "");
        if (event === "tool_use") emitted.push(`tool:${(data as { name?: string }).name}`);
      },
    );

    expect(seenRequests.length).toBe(2);
    expect(seenRequests[1].messages.at(-1)?.text).toContain("Continue now");
    expect(emitted).toEqual(["tool:read"]);
    expect(result.messages.at(-1)?.tool_calls?.[0]?.tool_name).toBe("read");
  });

  test("does not retry after a completed task update", async () => {
    const seenRequests: any[] = [];
    const emitted: string[] = [];
    const model: ModelAdapter = {
      name: "task-complete",
      async prompt(request, notify) {
        seenRequests.push(request);
        await notify("model_response" as any, { text: "Done." } as any);
        return {
          messages: [{ sender: "agent", text: "Done." }],
          tokens_in: 10,
          tokens_out: 1,
        };
      },
      setSystemPrompt() {},
    };

    const guarded = withTaskUpdateContinuation(model);
    const result = await guarded.prompt(
      {
        messages: [
          {
            sender: "user",
            text: "tool results",
            tool_results: [
              {
                tool_name: "glove_update_tasks",
                result: {
                  status: "success",
                  data: {
                    tasks: [
                      { id: "t1", content: "Edit file", activeForm: "Editing file", status: "completed" },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      async (event, data) => {
        if (event === "model_response") emitted.push((data as { text?: string }).text ?? "");
      },
    );

    expect(seenRequests.length).toBe(1);
    expect(emitted).toEqual(["Done."]);
    expect(result.messages.at(-1)?.text).toBe("Done.");
  });
});
