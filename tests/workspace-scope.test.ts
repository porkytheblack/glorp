import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { GlorpStore } from "../src/agent/store.ts";
import { listSessions } from "../src/agent/sessions.ts";
import { deriveProjectId } from "../src/agent/workspace-id.ts";

let dataDir: string;
let wsA: string;
let wsB: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-scope-data-"));
  wsA = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-scope-A-"));
  wsB = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-scope-B-"));
});

afterEach(() => {
  for (const d of [dataDir, wsA, wsB]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe("deriveProjectId", () => {
  test("returns a 16-char hex string for a non-git directory", () => {
    const id = deriveProjectId(wsA);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is stable across calls for the same path", () => {
    expect(deriveProjectId(wsA)).toBe(deriveProjectId(wsA));
  });

  test("differs between unrelated directories", () => {
    expect(deriveProjectId(wsA)).not.toBe(deriveProjectId(wsB));
  });

  test("resolves relative and absolute forms identically", () => {
    const sub = path.join(wsA, "child");
    fs.mkdirSync(sub);
    const absolute = deriveProjectId(sub);
    const relative = deriveProjectId(path.relative(process.cwd(), sub));
    expect(absolute).toBe(relative);
  });
});

describe("GlorpStore + listSessions — workspace scoping", () => {
  async function createSessionIn(workspace: string, sessionId: string, userText: string): Promise<void> {
    const store = new GlorpStore(sessionId, dataDir, { workspace });
    await store.appendMessages([{ sender: "user", text: userText }]);
    await store.flush();
  }

  test("GlorpStore stamps workspace + projectId on a fresh session", async () => {
    const store = new GlorpStore("s1", dataDir, { workspace: wsA });
    await store.appendMessages([{ sender: "user", text: "hi" }]);
    await store.flush();
    expect(store.getWorkspace()).toBe(wsA);
    expect(store.getProjectId()).toBe(deriveProjectId(wsA));
  });

  test("listSessions in 'all' mode returns every session", async () => {
    await createSessionIn(wsA, "a1", "task in A");
    await createSessionIn(wsB, "b1", "task in B");
    const all = await listSessions(dataDir, { kind: "all" });
    expect(all).toHaveLength(2);
  });

  test("listSessions in 'project' mode returns only matching sessions", async () => {
    await createSessionIn(wsA, "a1", "task in A");
    await createSessionIn(wsA, "a2", "another in A");
    await createSessionIn(wsB, "b1", "task in B");

    const projectA = await listSessions(dataDir, { kind: "project", workspace: wsA });
    expect(projectA.map((s) => s.id).sort()).toEqual(["a1", "a2"]);
    expect(projectA.every((s) => s.workspace === wsA)).toBe(true);

    const projectB = await listSessions(dataDir, { kind: "project", workspace: wsB });
    expect(projectB.map((s) => s.id)).toEqual(["b1"]);
  });

  test("project scope hides legacy snapshots with no workspace marker", async () => {
    // Create a snapshot that pre-dates workspace scoping by writing the raw
    // JSON directly — no metadata.workspace field.
    const sessionsDir = path.join(dataDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, "legacy-1.json"),
      JSON.stringify({
        messages: [{ sender: "user", text: "ancient task" }],
        tokensIn: 100,
        tokensOut: 50,
        turnCount: 1,
      }),
    );
    await createSessionIn(wsA, "modern-1", "current task");

    const scoped = await listSessions(dataDir, { kind: "project", workspace: wsA });
    expect(scoped.map((s) => s.id)).toEqual(["modern-1"]);

    const everything = await listSessions(dataDir, { kind: "all" });
    expect(everything.map((s) => s.id).sort()).toEqual(["legacy-1", "modern-1"]);
    const legacy = everything.find((s) => s.id === "legacy-1");
    expect(legacy?.workspace).toBeNull();
    expect(legacy?.projectId).toBeNull();
  });

  test("emitted SessionInfo carries workspace + projectId", async () => {
    await createSessionIn(wsA, "a1", "ok");
    const [info] = await listSessions(dataDir, { kind: "project", workspace: wsA });
    expect(info?.workspace).toBe(wsA);
    expect(info?.projectId).toBe(deriveProjectId(wsA));
  });
});
