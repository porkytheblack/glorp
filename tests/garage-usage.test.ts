/**
 * Token-usage + cost HTTP surface: GET /usage (namespace rollup), GET
 * /sessions/:id/usage (per-model), and the cost fields folded onto the
 * session / workspace DTOs. Usage is seeded by writing a store snapshot to
 * disk (no model call needed) — the manager reads dormant ledgers off disk.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GlorpStore } from "../src/agent/store.ts";
import { SessionManager } from "../src/garage/manager.ts";
import { startGarage } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";

const tmpDirs: string[] = [];
function tmp(prefix = "usage-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Seed a dormant session whose store has priced usage for one model. */
async function seedSession(dataDir: string, id: string, workspace: string): Promise<void> {
  const store = new GlorpStore(id, dataDir, { workspace });
  store.setActiveModel({ providerId: "anthropic", model: "opus", label: "anthropic · opus", cost: { input: 3, output: 15 } });
  await store.addTokens({ tokens_in: 1_000_000, tokens_out: 1_000_000 }); // → $18
  await store.flush();
}

describe("SessionManager usage rollup", () => {
  it("aggregates per-model, per-workspace, and per-session", async () => {
    const dataDir = tmp();
    const repo = tmp("repo-");
    await seedSession(dataDir, "ghost", repo);

    const m = new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
    const roll = await m.usageRollup();

    expect(roll.totals.tokensIn).toBe(1_000_000);
    expect(roll.totals.costUsd).toBeCloseTo(18, 4);
    expect(roll.totals.costKnown).toBe(true);
    expect(roll.byModel).toHaveLength(1);
    expect(roll.byModel[0]).toMatchObject({ providerId: "anthropic", model: "opus" });
    expect(roll.bySession.find((s) => s.sessionId === "ghost")?.totals.costUsd).toBeCloseTo(18, 4);
    expect(roll.byWorkspace[0]?.totals.costUsd).toBeCloseTo(18, 4);

    const one = await m.sessionUsage("ghost");
    expect(one?.totals.costUsd).toBeCloseTo(18, 4);
    expect(one?.usage[0]?.label).toBe("anthropic · opus");
  });
});

describe("Usage HTTP surface", () => {
  it("serves /usage and /sessions/:id/usage with cost on the DTOs", async () => {
    const dataDir = tmp();
    const repo = tmp("repo-");
    await seedSession(dataDir, "ghost", repo);

    const config = loadGarageConfig({ dataDir, port: 0, hostname: "127.0.0.1" });
    const garage = await startGarage(config);
    const base = `http://127.0.0.1:${garage.port}`;
    const get = async (p: string) => {
      const r = await fetch(base + p);
      const t = await r.text();
      return { status: r.status, body: t ? JSON.parse(t) : null };
    };

    try {
      const usage = await get("/usage");
      expect(usage.status).toBe(200);
      expect(usage.body.totals.cost_usd).toBeCloseTo(18, 4);
      expect(usage.body.by_model.some((m: any) => m.model === "opus" && m.cost_usd > 0)).toBe(true);
      expect(usage.body.by_session.some((s: any) => s.session_id === "ghost")).toBe(true);

      const one = await get("/sessions/ghost/usage");
      expect(one.status).toBe(200);
      expect(one.body.models[0].label).toBe("anthropic · opus");
      expect(one.body.totals.cost_known).toBe(true);

      // The session + workspace list DTOs carry the cost scalars too.
      const sessions = await get("/sessions");
      const ghost = sessions.body.sessions.find((s: any) => s.id === "ghost");
      expect(ghost.cost_usd).toBeCloseTo(18, 4);
      expect(ghost.cost_known).toBe(true);

      const workspaces = await get("/workspaces");
      expect(workspaces.body.workspaces.some((w: any) => w.cost_usd > 0)).toBe(true);

      // Unknown session → 404, not a crash.
      expect((await get("/sessions/nope/usage")).status).toBe(404);
    } finally {
      await garage.stop();
    }
  });
});
