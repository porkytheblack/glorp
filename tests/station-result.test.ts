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
      reason: string;
    };
    expect(body.text).toBeNull();
    expect(body.busy).toBe(false);
    expect(["idle", "provisioning"]).toContain(body.status);
    expect(body.turn_count).toBe(0);
    // A never-run session reports "idle" (no worker engaged) — NOT "empty",
    // which is reserved for a turn that completed and produced no text.
    expect(["idle", "provisioning"]).toContain(body.reason);

    expect((await fetch(`${base}/sessions/does-not-exist/result`)).status).toBe(404);
  });
});
