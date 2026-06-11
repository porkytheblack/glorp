/**
 * GarageSession behavior fixes: FIFO message queue (a message mid-task waits
 * instead of aborting the running turn), persisted profile choice, and
 * born-idle lifecycle (no phantom "provisioning").
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GarageSession } from "../src/garage/session.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "garage-session-"));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeSession(id = "s_test"): GarageSession {
  return new GarageSession({
    id,
    workspace: dataDir,
    workspaceId: null,
    dataDir,
    permissionMode: "normal",
  } as never);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("GarageSession", () => {
  test("is born idle — dormant/unbuilt sessions are not 'provisioning'", () => {
    expect(makeSession().state).toBe("idle");
  });

  test("queues messages FIFO: a send during a running turn waits for it", async () => {
    const session = makeSession();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    (session as never as { ensureBuilt: () => Promise<unknown> }).ensureBuilt = async () => ({
      send: async (text: string) => {
        log.push(`start:${text}`);
        if (text === "slow") await gate;
        log.push(`end:${text}`);
      },
    });

    const p1 = session.send("slow");
    const p2 = session.send("fast");
    await sleep(30);
    // The second message must NOT have started (old behavior: it aborted the first).
    expect(log).toEqual(["start:slow"]);
    expect(session.queuedMessages).toBe(1);

    release();
    await Promise.all([p1, p2]);
    expect(log).toEqual(["start:slow", "end:slow", "start:fast", "end:fast"]);
    expect(session.queuedMessages).toBe(0);
  });

  test("swapProfile persists the choice and a rebuilt session inherits it", async () => {
    const session = makeSession("s_prefs");
    const swapped: string[] = [];
    (session as never as { ensureBuilt: () => Promise<unknown> }).ensureBuilt = async () => ({
      swapProfile: async (id: string) => void swapped.push(id),
    });
    await session.swapProfile("custom-moonshot__kimi-k2-6");
    expect(swapped).toEqual(["custom-moonshot__kimi-k2-6"]);

    // A brand-new instance for the same session id (process restart, GC
    // reload, rebuild) must pick the persisted profile up.
    const reborn = makeSession("s_prefs");
    expect((reborn as never as { init: { profileId?: string } }).init.profileId).toBe("custom-moonshot__kimi-k2-6");
  });
});

describe("error replay + dedupe", () => {
  test("fail() emits once per distinct failure, even when multiple paths report it", () => {
    const session = makeSession("s_fail");
    const errors: unknown[] = [];
    session.bridge.subscribe((ev) => { if (ev.type === "error") errors.push(ev); });
    const boom = new Error("401 Invalid Authentication at generate");
    session.fail(boom);
    session.fail(boom); // hydrate-on-connect path reporting the same failure
    expect(errors).toHaveLength(1);
    expect((errors[0] as { kind?: string }).kind).toBe("auth");
    expect(session.state).toBe("error");
  });

  test("buffers recent errors (capped) for hydrate replay", () => {
    const session = makeSession("s_buf");
    for (let i = 0; i < 14; i++) {
      session.bridge.emit({ type: "error", message: `e${i}` });
    }
    const buffered = (session as never as { recentErrors: unknown[] }).recentErrors;
    expect(buffered.length).toBe(10); // capped
    expect((buffered[9] as { message: string }).message).toBe("e13"); // newest kept
  });
});
