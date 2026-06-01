import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Message } from "glove-core/core";

import { withSessionState } from "../src/agent/session-state.ts";
import { GlorpStore } from "../src/agent/store.ts";
import type { OriginalRequest } from "../src/agent/store-snapshot.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-state-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

const ORIGINAL: OriginalRequest = {
  id: "u-first",
  text: "create a doc explaining the glove framework",
  capturedAt: "2026-05-24T08:00:00.000Z",
};

const emptyState = { plan: null, tasks: [], inboxItems: [] };

describe("withSessionState — original-request anchor", () => {
  test("injects an anchor when the original message is no longer in the transcript", () => {
    const messages: Message[] = [
      { sender: "user", text: "[Conversation summary from compaction]\nGoal: PM resume", is_compaction: true },
      { sender: "user", text: "do you remember what you're supposed to do?" },
    ];
    const out = withSessionState(messages, { ...emptyState, originalRequest: ORIGINAL });

    const anchor = out.find((m) => m.is_skill_injection && m.text.includes("Original user request"));
    expect(anchor).toBeDefined();
    expect(anchor!.text).toContain("create a doc explaining the glove framework");

    // The anchor must sit immediately before the latest user message, so the
    // model reads it right before deciding what to do next.
    const anchorIdx = out.indexOf(anchor!);
    const latestUserIdx = out.findIndex(
      (m) => m.sender === "user" && !m.is_skill_injection && !m.is_compaction,
    );
    // Latest non-injection user message must come AFTER the anchor.
    expect(anchorIdx).toBeLessThan(out.length - 1);
    expect(out[anchorIdx + 1]?.text).toBe("do you remember what you're supposed to do?");
  });

  test("skips the anchor when the original message id is still in the transcript", () => {
    const messages: Message[] = [
      { id: "u-first", sender: "user", text: ORIGINAL.text },
      { sender: "agent", text: "ok" },
    ];
    const out = withSessionState(messages, { ...emptyState, originalRequest: ORIGINAL });
    const anchors = out.filter((m) => m.is_skill_injection && m.text.includes("Original user request"));
    expect(anchors).toHaveLength(0);
  });

  test("no anchor and no state when nothing to inject", () => {
    const messages: Message[] = [{ sender: "user", text: "hi" }];
    const out = withSessionState(messages, emptyState);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("hi");
  });

  test("injects an anchor when the original survives in the store but before the last compaction", () => {
    // Real compaction flow: the summary is appended, but the original user
    // message is NOT deleted from the store — glove-core hides it by slicing
    // at read time. The anchor must still fire because the model's window
    // (everything after the summary) no longer contains the original.
    const messages: Message[] = [
      { id: "u-first", sender: "user", text: ORIGINAL.text },
      { sender: "agent", text: "working on it" },
      { sender: "user", text: "[Conversation summary from compaction]\nGoal: …", is_compaction: true },
      { sender: "user", text: "tool results", tool_results: [] as any } as any,
    ];
    const out = withSessionState(messages, { ...emptyState, originalRequest: ORIGINAL });

    const anchor = out.find((m) => m.is_skill_injection && m.text.includes("Original user request"));
    expect(anchor).toBeDefined();
    expect(anchor!.text).toContain(ORIGINAL.text);

    // The anchor must land inside the live window — at or after the summary —
    // so glove-core's splitAtLastCompaction keeps it.
    const compactionIdx = out.findIndex((m) => m.is_compaction);
    expect(out.indexOf(anchor!)).toBeGreaterThan(compactionIdx);
  });

  test("session state lands after the compaction boundary in a mid-task continuation", () => {
    // No new user message has arrived after the compaction — the latest real
    // user message sits before the summary. The state block must still land
    // in the post-compaction window or the agent loses its task list.
    const messages: Message[] = [
      { id: "u-first", sender: "user", text: ORIGINAL.text },
      { sender: "agent", text: "ok" },
      { sender: "user", text: "summary", is_compaction: true },
      { sender: "user", text: "tool results", tool_results: [] as any } as any,
    ];
    const out = withSessionState(messages, {
      plan: null,
      tasks: [
        { id: "t1", content: "wire up the parser", activeForm: "wiring the parser", status: "in_progress" } as any,
      ],
      inboxItems: [],
      originalRequest: ORIGINAL,
    });

    const stateMsg = out.find((m) => m.is_skill_injection && m.text.includes("Current Glorp session state"));
    expect(stateMsg).toBeDefined();
    expect(stateMsg!.text).toContain("wire up the parser");

    const compactionIdx = out.findIndex((m) => m.is_compaction);
    expect(out.indexOf(stateMsg!)).toBeGreaterThan(compactionIdx);
  });

  test("clips an over-long original request to a manageable size", () => {
    const longText = "x".repeat(10_000);
    const messages: Message[] = [
      { sender: "user", text: "summary", is_compaction: true },
      { sender: "user", text: "continue" },
    ];
    const out = withSessionState(messages, {
      ...emptyState,
      originalRequest: { id: "u-first", text: longText, capturedAt: "x" },
    });
    const anchor = out.find((m) => m.is_skill_injection && m.text.includes("Original user request"));
    expect(anchor).toBeDefined();
    // Anchor body should be clipped, not 10k characters of x.
    expect(anchor!.text.length).toBeLessThan(5_500);
  });
});

describe("GlorpStore — originalRequest capture and persistence", () => {
  test("captures first real user message on appendMessages", async () => {
    const store = new GlorpStore("orig-1", dataDir);
    expect(store.getOriginalRequest()).toBeNull();

    await store.appendMessages([
      { id: "skill", sender: "user", text: "[Skill: docx]", is_skill_injection: true },
      { id: "u1", sender: "user", text: "create a doc explaining the glove framework" },
      { id: "a1", sender: "agent", text: "on it" },
    ]);

    const captured = store.getOriginalRequest();
    expect(captured).not.toBeNull();
    expect(captured!.id).toBe("u1");
    expect(captured!.text).toBe("create a doc explaining the glove framework");
  });

  test("ignores tool-result, skill-injection, and compaction messages when picking the original", async () => {
    const store = new GlorpStore("orig-2", dataDir);
    await store.appendMessages([
      { sender: "user", text: "tool results", tool_results: [] as any } as any,
      { sender: "user", text: "[skill]", is_skill_injection: true },
      { sender: "user", text: "summary", is_compaction: true },
      { id: "u-real", sender: "user", text: "the real ask" },
    ]);
    expect(store.getOriginalRequest()?.text).toBe("the real ask");
  });

  test("does not overwrite a captured original on later appends", async () => {
    const store = new GlorpStore("orig-3", dataDir);
    await store.appendMessages([{ id: "u1", sender: "user", text: "first" }]);
    await store.appendMessages([{ id: "u2", sender: "user", text: "second" }]);
    expect(store.getOriginalRequest()?.text).toBe("first");
  });

  test("survives a reload from disk", async () => {
    const seed = new GlorpStore("orig-4", dataDir);
    await seed.appendMessages([{ id: "u1", sender: "user", text: "lock me in" }]);
    await seed.flush();

    const reloaded = new GlorpStore("orig-4", dataDir);
    expect(reloaded.getOriginalRequest()?.text).toBe("lock me in");
  });

  test("back-fills originalRequest on load when an older snapshot lacks it", async () => {
    const seed = new GlorpStore("orig-5", dataDir);
    await seed.appendMessages([{ id: "u1", sender: "user", text: "earlier task" }]);
    await seed.flush();

    // Simulate an older on-disk snapshot that predates the originalRequest field.
    const snapPath = path.join(dataDir, "sessions", "orig-5.json");
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));
    delete snap.originalRequest;
    fs.writeFileSync(snapPath, JSON.stringify(snap));

    const reloaded = new GlorpStore("orig-5", dataDir);
    expect(reloaded.getOriginalRequest()?.text).toBe("earlier task");
  });

  test("getMessages surfaces an anchor after compaction has wiped the original", async () => {
    const store = new GlorpStore("orig-6", dataDir);
    // First real user message — captured.
    await store.appendMessages([{ id: "u1", sender: "user", text: "build me thing X" }]);
    // Simulate compaction having replaced the early transcript with a summary
    // message — internally the store just receives appendMessages, so we
    // approximate the same end-state with a fresh store loaded from a snapshot
    // whose `messages` no longer contains u1.
    await store.flush();

    const snapPath = path.join(dataDir, "sessions", "orig-6.json");
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));
    snap.messages = [
      { sender: "user", text: "Conversation summary…", is_compaction: true },
      { sender: "user", text: "what was I doing again?" },
    ];
    fs.writeFileSync(snapPath, JSON.stringify(snap));

    const reloaded = new GlorpStore("orig-6", dataDir);
    const out = await reloaded.getMessages();
    const anchor = out.find((m) => m.is_skill_injection && m.text.includes("Original user request"));
    expect(anchor).toBeDefined();
    expect(anchor!.text).toContain("build me thing X");
  });
});
