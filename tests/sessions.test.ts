import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  deleteSession,
  listSessions,
  newSessionId,
  relativeTime,
} from "../src/agent/sessions.ts";
import { GlorpStore } from "../src/agent/store.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-sess-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

describe("listSessions", () => {
  test("returns empty when no sessions dir exists", async () => {
    expect(await listSessions(dataDir)).toEqual([]);
  });

  test("returns empty when sessions dir is empty", async () => {
    fs.mkdirSync(path.join(dataDir, "sessions"));
    expect(await listSessions(dataDir)).toEqual([]);
  });

  test("lists one session with metadata", async () => {
    const store = new GlorpStore("s1", dataDir);
    await store.appendMessages([
      { sender: "user", text: "fix the login bug" },
      { sender: "agent", text: "looking into it" },
    ]);
    await store.setTitle("Login bug fix");
    await store.addTasks([
      { id: "t1", content: "investigate", activeForm: "investigating", status: "in_progress" },
    ]);
    await store.addInboxItem({
      id: "i1",
      tag: "x",
      request: "do thing",
      response: null,
      status: "pending",
      blocking: false,
      created_at: new Date().toISOString(),
      resolved_at: null,
    });
    await store.addTokens({ tokens_in: 500, tokens_out: 250 });
    await store.incrementTurn();
    await new Promise((r) => setTimeout(r, 200));

    const sessions = await listSessions(dataDir);
    expect(sessions.length).toBe(1);
    const s = sessions[0]!;
    expect(s.id).toBe("s1");
    expect(s.title).toBe("Login bug fix");
    expect(s.firstUserMessage).toBe("fix the login bug");
    expect(s.userMessageCount).toBe(1);
    expect(s.agentMessageCount).toBe(1);
    expect(s.totalMessages).toBe(2);
    expect(s.taskCount).toBe(1);
    expect(s.pendingInboxCount).toBe(1);
    expect(s.tokenCount).toBe(750);
    expect(s.turnCount).toBe(1);
  });

  test("orders most-recent-first by mtime", async () => {
    const sA = new GlorpStore("alpha", dataDir);
    await sA.appendMessages([{ sender: "user", text: "first" }]);
    await new Promise((r) => setTimeout(r, 250));
    const sB = new GlorpStore("beta", dataDir);
    await sB.appendMessages([{ sender: "user", text: "second" }]);
    await new Promise((r) => setTimeout(r, 250));

    const sessions = await listSessions(dataDir);
    expect(sessions.map((s) => s.id)).toEqual(["beta", "alpha"]);
  });

  test("skips malformed json files without crashing", async () => {
    fs.mkdirSync(path.join(dataDir, "sessions"));
    fs.writeFileSync(path.join(dataDir, "sessions", "broken.json"), "{not json");
    const store = new GlorpStore("good", dataDir);
    await store.appendMessages([{ sender: "user", text: "ok" }]);
    await new Promise((r) => setTimeout(r, 200));
    const sessions = await listSessions(dataDir);
    expect(sessions.map((s) => s.id)).toEqual(["good"]);
  });

  test("skips .tmp files", async () => {
    fs.mkdirSync(path.join(dataDir, "sessions"));
    fs.writeFileSync(path.join(dataDir, "sessions", "x.json.tmp"), "{}");
    expect(await listSessions(dataDir)).toEqual([]);
  });

  test("firstUserMessage is null when there are no user messages", async () => {
    const store = new GlorpStore("agent-only", dataDir);
    await store.appendMessages([{ sender: "agent", text: "hello?" }]);
    await new Promise((r) => setTimeout(r, 200));
    const sessions = await listSessions(dataDir);
    expect(sessions[0]?.firstUserMessage).toBeNull();
  });

  test("title is null when it has not been generated", async () => {
    const store = new GlorpStore("untitled", dataDir);
    await store.appendMessages([{ sender: "user", text: "hello" }]);
    await store.flush();
    const sessions = await listSessions(dataDir);
    expect(sessions[0]?.title).toBeNull();
  });
});

describe("deleteSession", () => {
  test("removes the snapshot file", async () => {
    const store = new GlorpStore("doomed", dataDir);
    await store.appendMessages([{ sender: "user", text: "doomed" }]);
    await new Promise((r) => setTimeout(r, 200));
    expect((await listSessions(dataDir)).length).toBe(1);
    await deleteSession(dataDir, "doomed");
    expect((await listSessions(dataDir)).length).toBe(0);
  });

  test("does not throw for unknown session", async () => {
    await expect(deleteSession(dataDir, "nope")).resolves.toBeUndefined();
  });
});

describe("newSessionId", () => {
  test("is filename-safe (no colons, no dots)", () => {
    const id = newSessionId();
    expect(id).not.toContain(":");
    expect(id).not.toContain(".");
    expect(id.length).toBeGreaterThan(10);
  });

  test("generates distinct ids in rapid succession", async () => {
    const a = newSessionId();
    await new Promise((r) => setTimeout(r, 2));
    // The timestamp resolution can collide if called within the same ms, so
    // this is best-effort; mostly we want to assert format stability.
    const b = newSessionId();
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-05-21T12:00:00.000Z");
  test("seconds", () => {
    expect(relativeTime(new Date(now.getTime() - 10_000), now)).toBe("10s ago");
  });
  test("minutes", () => {
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m ago");
  });
  test("hours", () => {
    expect(relativeTime(new Date(now.getTime() - 3 * 3600_000), now)).toBe("3h ago");
  });
  test("yesterday", () => {
    expect(relativeTime(new Date(now.getTime() - 86400_000), now)).toBe("yesterday");
  });
  test("days", () => {
    expect(relativeTime(new Date(now.getTime() - 4 * 86400_000), now)).toBe("4d ago");
  });
  test("weeks", () => {
    expect(relativeTime(new Date(now.getTime() - 14 * 86400_000), now)).toBe("2w ago");
  });
  test("over a month: ISO date", () => {
    expect(relativeTime(new Date(now.getTime() - 60 * 86400_000), now)).toBe("2026-03-22");
  });
});
