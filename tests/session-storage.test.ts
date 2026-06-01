/**
 * Per-session folder layout + backward compatibility with the legacy flat
 * layout: path resolution, session discovery across both, and full deletion.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveSessionPaths, agentStoreFile } from "../src/agent/session-paths.ts";
import { listSessions, deleteSession } from "../src/agent/sessions.ts";

let dataDir: string;

beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-sessstore-")); });
afterEach(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const sessionsDir = () => path.join(dataDir, "sessions");
function writeSnapshot(file: string, opts: { workspace?: string } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    metadata: { kind: "session", createdAt: new Date().toISOString(), ...(opts.workspace ? { workspace: opts.workspace, projectId: "p" } : {}) },
    messages: [{ sender: "user", text: "hi" }, { sender: "agent", text: "hello" }],
    tasks: [], inboxItems: [], tokensIn: 1, tokensOut: 2, turnCount: 1,
  }), "utf-8");
}

describe("session path resolution", () => {
  test("a fresh session uses the folder layout", () => {
    const p = resolveSessionPaths(dataDir, "fresh-1");
    expect(p.legacy).toBe(false);
    expect(p.storeFile).toBe(path.join(sessionsDir(), "fresh-1", "session.json"));
    expect(p.errorsFile).toBe(path.join(sessionsDir(), "fresh-1", "errors.log"));
    expect(p.meshDir).toBe(path.join(sessionsDir(), "fresh-1", "mesh"));
    expect(agentStoreFile(p, "a_x")).toBe(path.join(sessionsDir(), "fresh-1", "agents", "a_x", "session.json"));
  });

  test("an existing flat session is detected as legacy and kept in place", () => {
    const flat = path.join(sessionsDir(), "old-1.json");
    writeSnapshot(flat);
    const p = resolveSessionPaths(dataDir, "old-1");
    expect(p.legacy).toBe(true);
    expect(p.storeFile).toBe(flat);
    expect(p.rosterFile).toBe(path.join(sessionsDir(), "old-1.roster.json"));
    expect(agentStoreFile(p, "a_x")).toBe(path.join(sessionsDir(), "old-1__a_x.json"));
  });
});

describe("listSessions across layouts", () => {
  test("lists folder + legacy sessions, ignoring sidecars and agent stores", async () => {
    writeSnapshot(path.join(sessionsDir(), "legacyA.json"));                 // legacy session
    writeSnapshot(path.join(sessionsDir(), "folderB", "session.json"));      // folder session
    // noise that must NOT be listed as sessions:
    fs.writeFileSync(path.join(sessionsDir(), "legacyA.roster.json"), "{}");
    fs.writeFileSync(path.join(sessionsDir(), "legacyA.resources.json"), JSON.stringify({ dirs: [], files: [] }));
    writeSnapshot(path.join(sessionsDir(), "legacyA__a_1.json"));            // conversational agent store
    fs.mkdirSync(path.join(sessionsDir(), "folderB", "agents", "a_1"), { recursive: true });
    writeSnapshot(path.join(sessionsDir(), "folderB", "agents", "a_1", "session.json"));

    const sessions = await listSessions(dataDir, { kind: "all" });
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(["folderB", "legacyA"]);
  });
});

describe("deleteSession", () => {
  test("removes folder-layout storage entirely", async () => {
    const root = path.join(sessionsDir(), "del-1");
    writeSnapshot(path.join(root, "session.json"));
    fs.mkdirSync(path.join(root, "mesh"), { recursive: true });
    fs.writeFileSync(path.join(root, "errors.log"), "x");
    expect(fs.existsSync(root)).toBe(true);
    await deleteSession(dataDir, "del-1");
    expect(fs.existsSync(root)).toBe(false);
  });

  test("removes legacy flat storage entirely", async () => {
    writeSnapshot(path.join(sessionsDir(), "del-2.json"));
    fs.writeFileSync(path.join(sessionsDir(), "del-2.roster.json"), "{}");
    fs.mkdirSync(path.join(dataDir, "mesh", "del-2"), { recursive: true });
    await deleteSession(dataDir, "del-2");
    expect(fs.existsSync(path.join(sessionsDir(), "del-2.json"))).toBe(false);
    expect(fs.existsSync(path.join(sessionsDir(), "del-2.roster.json"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "mesh", "del-2"))).toBe(false);
  });
});
