/**
 * Idle-session GC (`SessionManager.reapIdle`). The reaping predicate is what
 * matters, so we drive it directly: the no-LLM cases (disabled TTL, unloaded
 * sessions) use real sessions, and the *loaded* path is exercised with injected
 * fake sessions — building a real handle needs a model adapter these tests avoid.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SessionManager } from "../src/garage/manager.ts";

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

/** A minimal stand-in implementing exactly the surface `reapIdle` reads. */
interface FakeSession {
  id: string;
  loaded: boolean;
  state: string;
  stats: { busy: boolean };
  stream: { size: number };
  lastActivity: number;
  destroyed: boolean;
  openSlots(): unknown[];
  flush(): Promise<void>;
  destroy(): Promise<void>;
}

function fakeLoaded(
  id: string,
  opts: { busy?: boolean; clients?: number; ageMs?: number; state?: string; slots?: number } = {},
): FakeSession {
  return {
    id,
    loaded: true,
    state: opts.state ?? "idle",
    stats: { busy: opts.busy ?? false },
    stream: { size: opts.clients ?? 0 },
    lastActivity: Date.now() - (opts.ageMs ?? 0),
    destroyed: false,
    openSlots: () => Array.from({ length: opts.slots ?? 0 }, () => ({})),
    async flush() {},
    async destroy() {
      this.destroyed = true;
    },
  };
}

/** Drop a fake session straight into the manager's live registry. */
function inject(mgr: SessionManager, f: FakeSession): void {
  (mgr as unknown as { sessions: Map<string, unknown> }).sessions.set(f.id, f);
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("SessionManager.reapIdle", () => {
  it("is a no-op when the TTL is disabled (<= 0)", async () => {
    const mgr = manager(tmp());
    inject(mgr, fakeLoaded("s1", { ageMs: 60 * 60_000 }));
    expect(await mgr.reapIdle(0)).toEqual([]);
  });

  it("never reaps a session whose handle isn't built (holds no agent host)", async () => {
    const mgr = manager(tmp());
    const session = await mgr.create({ sessionId: "s1" });
    expect(session.loaded).toBe(false);
    session.lastActivity = 0; // ancient, but unloaded ⇒ still skipped
    expect(await mgr.reapIdle(1, Date.now())).toEqual([]);
    expect(mgr.get("s1")).toBeDefined();
  });

  it("unloads a loaded session idle past the TTL and drops it from the registry", async () => {
    const mgr = manager(tmp());
    const f = fakeLoaded("old", { ageMs: 10 * 60_000 });
    inject(mgr, f);
    expect(await mgr.reapIdle(60_000)).toEqual(["old"]);
    expect(f.destroyed).toBe(true);
    expect(mgr.get("old")).toBeUndefined();
  });

  it("keeps a loaded session that is busy, watched, or younger than the TTL", async () => {
    const mgr = manager(tmp());
    inject(mgr, fakeLoaded("busy", { busy: true, ageMs: 10 * 60_000 }));
    inject(mgr, fakeLoaded("watched", { clients: 1, ageMs: 10 * 60_000 }));
    inject(mgr, fakeLoaded("fresh", { ageMs: 1_000 }));
    expect(await mgr.reapIdle(60_000)).toEqual([]);
    expect(mgr.get("busy")).toBeDefined();
    expect(mgr.get("watched")).toBeDefined();
    expect(mgr.get("fresh")).toBeDefined();
  });

  it("keeps a session whose teardown throws, so a later sweep can retry", async () => {
    const mgr = manager(tmp());
    const f = fakeLoaded("boom", { ageMs: 10 * 60_000 });
    f.destroy = async () => {
      throw new Error("shutdown failed");
    };
    inject(mgr, f);
    expect(await mgr.reapIdle(60_000)).toEqual([]);
    expect(mgr.get("boom")).toBeDefined();
  });
});

describe("SessionManager.reapIdleReport (GC observability)", () => {
  it("reports the reaped ids, the scanned count, and why each session was kept", async () => {
    const mgr = manager(tmp());
    inject(mgr, fakeLoaded("busy", { busy: true, ageMs: 10 * 60_000 }));
    inject(mgr, fakeLoaded("watched", { clients: 2, ageMs: 10 * 60_000 }));
    inject(mgr, fakeLoaded("asking", { slots: 1, ageMs: 10 * 60_000 }));
    inject(mgr, fakeLoaded("fresh", { ageMs: 1_000 }));
    inject(mgr, fakeLoaded("old", { ageMs: 10 * 60_000 }));

    const report = await mgr.reapIdleReport(60_000);

    expect(report.reaped).toEqual(["old"]);
    expect(report.scanned).toBe(5); // every loaded session, reaped or kept
    const byReason = Object.fromEntries(report.skipped.map((s) => [s.id, s.reason]));
    expect(byReason).toEqual({
      busy: "busy",
      watched: "watched",
      asking: "awaiting-input",
      fresh: "fresh",
    });
    // The "watched" entry carries its connected-client count for the log.
    expect(report.skipped.find((s) => s.id === "watched")?.clients).toBe(2);
  });

  it("excludes dormant (unloaded) sessions — they hold no agent host", async () => {
    const mgr = manager(tmp());
    const dormant = fakeLoaded("dormant", { ageMs: 10 * 60_000 });
    dormant.loaded = false;
    inject(mgr, dormant);

    const report = await mgr.reapIdleReport(60_000);
    expect(report).toEqual({ scanned: 0, reaped: [], skipped: [] });
  });

  it("scans nothing when the TTL is disabled (<= 0)", async () => {
    const mgr = manager(tmp());
    inject(mgr, fakeLoaded("old", { ageMs: 10 * 60_000 }));
    expect(await mgr.reapIdleReport(0)).toEqual({ scanned: 0, reaped: [], skipped: [] });
  });
});
