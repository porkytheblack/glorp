/**
 * Idle-session GC (`SessionManager.reapIdle`). Exercised without an LLM, so we
 * assert the guards that keep it safe: it never touches a disabled TTL, never
 * reaps a dormant (unloaded) session — which holds no agent host — and leaves
 * the on-disk snapshot intact so a reaped session can rehydrate.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SessionManager } from "../src/station/manager.ts";

const tmpDirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gc-test-"));
  tmpDirs.push(d);
  return d;
}

function manager(dataDir: string): SessionManager {
  return new SessionManager({
    dataDir,
    workspaceRoot: path.join(dataDir, "workspaces"),
    permissionMode: "normal",
  });
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("SessionManager.reapIdle", () => {
  it("is a no-op when the TTL is disabled (<= 0)", async () => {
    const mgr = manager(tmp());
    await mgr.create({ sessionId: "s1" });
    expect(await mgr.reapIdle(0)).toEqual([]);
  });

  it("never reaps a session whose handle isn't built (holds no agent host)", async () => {
    const dataDir = tmp();
    const mgr = manager(dataDir);
    const session = await mgr.create({ sessionId: "s1" });
    expect(session.loaded).toBe(false);
    // Even with a zero idle window and an ancient lastActivity, an unloaded
    // session is skipped — there's no agent host to reclaim.
    session.lastActivity = 0;
    expect(await mgr.reapIdle(1, Date.now())).toEqual([]);
    expect(mgr.get("s1")).toBeDefined();
  });

  it("keeps younger-than-TTL sessions even when loaded would qualify", async () => {
    const mgr = manager(tmp());
    const session = await mgr.create({ sessionId: "s1" });
    session.lastActivity = Date.now();
    expect(await mgr.reapIdle(60_000)).toEqual([]);
    expect(mgr.get("s1")).toBeDefined();
  });
});
