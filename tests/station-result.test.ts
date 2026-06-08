/**
 * GET /sessions/:id/result — the one-call status + latest-answer fetch used by
 * orchestration. Exercised without an LLM: a fresh session is idle with no text.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startStation, type StationHandle } from "../src/station/server.ts";
import { loadStationConfig } from "../src/station/config.ts";
import { SessionManager } from "../src/station/manager.ts";
import { stateRoutes } from "../src/station/routes/state.ts";

const tmpDirs: string[] = [];
const stations: StationHandle[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "result-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const s of stations.splice(0)) await s.stop().catch(() => {});
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("GET /sessions/:id/result", () => {
  it("returns status + null text for a fresh session, and 404 for unknown", async () => {
    const station = await startStation(loadStationConfig({ hostname: "127.0.0.1", port: 0, dataDir: tmp() }));
    stations.push(station);
    const base = `http://127.0.0.1:${station.port}`;

    const created = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: tmp() }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await fetch(`${base}/api/v1/sessions/${id}/result`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      busy: boolean;
      text: string | null;
      turn_count: number;
      last_error: string | null;
      last_turn_state: "ok" | "error" | null;
    };
    expect(body.text).toBeNull();
    expect(body.busy).toBe(false);
    expect(["idle", "provisioning"]).toContain(body.status);
    expect(body.turn_count).toBe(0);
    // A fresh session has run no turns: no last error, no last-turn outcome.
    expect(body.last_error).toBeNull();
    expect(body.last_turn_state).toBeNull();

    expect((await fetch(`${base}/sessions/does-not-exist/result`)).status).toBe(404);
  });

  it("surfaces a failed turn's error as last_error (distinct from an empty turn)", async () => {
    const dataDir = tmp();
    const manager = new SessionManager({
      dataDir,
      workspaceRoot: path.join(dataDir, "workspaces"),
      permissionMode: "normal",
    });
    const session = await manager.create({ workspace: tmp() });
    const routes = stateRoutes(manager);

    // Simulate a turn that runs then 400s mid-stream (a bridge `error` event,
    // not a fatal session failure): busy → error → idle. This is exactly the
    // shape the model-400 produces — the session stays healthy and idle.
    session.bridge.emit({ type: "busy", busy: true });
    session.bridge.emit({ type: "error", message: "400 … 512000 in the output" });
    session.bridge.emit({ type: "busy", busy: false });

    const res = await routes.result(session.id);
    const body = (await res.json()) as {
      busy: boolean;
      text: string | null;
      error: string | null;
      last_error: string | null;
      last_turn_state: "ok" | "error" | null;
    };
    // Looks idle-with-no-output, but last_error/last_turn_state expose the failure.
    expect(body.busy).toBe(false);
    expect(body.text).toBeNull();
    expect(body.error).toBeNull(); // not a fatal session error
    expect(body.last_error).toBe("400 … 512000 in the output");
    expect(body.last_turn_state).toBe("error");
  });
});
