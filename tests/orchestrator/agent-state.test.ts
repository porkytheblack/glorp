import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  upsertAgentRecord,
  markAgentStopped,
  markAllInterrupted,
  loadAgentRecords,
  pruneStaleRecords,
  type AgentRecord,
} from "../../src/orchestrator/agent-state.ts";

let meshDir: string;

beforeEach(async () => { meshDir = await mkdtemp(join(tmpdir(), "state-")); });
afterEach(async () => { await rm(meshDir, { recursive: true, force: true }); });

function record(id: string, overrides?: Partial<AgentRecord>): AgentRecord {
  return {
    id, label: id, role: "builder", slot: "background", status: "running",
    runId: `run_${id}`, spawnedAt: Date.now(), ...overrides,
  };
}

describe("upsertAgentRecord", () => {
  test("creates state file on first write", async () => {
    await upsertAgentRecord(meshDir, record("a1"));
    const records = await loadAgentRecords(meshDir);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("a1");
  });

  test("updates existing record by id", async () => {
    await upsertAgentRecord(meshDir, record("a1"));
    await upsertAgentRecord(meshDir, record("a1", { status: "completed" }));
    const records = await loadAgentRecords(meshDir);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
  });

  test("appends new records", async () => {
    await upsertAgentRecord(meshDir, record("a1"));
    await upsertAgentRecord(meshDir, record("a2"));
    const records = await loadAgentRecords(meshDir);
    expect(records).toHaveLength(2);
  });
});

describe("markAgentStopped", () => {
  test("updates status and adds timestamp", async () => {
    await upsertAgentRecord(meshDir, record("s1"));
    await markAgentStopped(meshDir, "s1" as any, "done");
    const records = await loadAgentRecords(meshDir);
    expect(records[0].status).toBe("stopped");
    expect(records[0].stopReason).toBe("done");
    expect(records[0].stoppedAt).toBeGreaterThan(0);
  });

  test("no-ops for unknown id", async () => {
    await upsertAgentRecord(meshDir, record("s1"));
    await markAgentStopped(meshDir, "unknown" as any, "reason");
    const records = await loadAgentRecords(meshDir);
    expect(records[0].status).toBe("running");
  });
});

describe("markAllInterrupted", () => {
  test("marks only running agents", async () => {
    await upsertAgentRecord(meshDir, record("r1"));
    await upsertAgentRecord(meshDir, record("r2", { status: "completed" }));
    await markAllInterrupted(meshDir);
    const records = await loadAgentRecords(meshDir);
    expect(records.find((r) => r.id === "r1")!.status).toBe("interrupted");
    expect(records.find((r) => r.id === "r2")!.status).toBe("completed");
  });
});

describe("pruneStaleRecords", () => {
  test("removes old stopped records", async () => {
    await upsertAgentRecord(meshDir, record("old", {
      status: "stopped", stoppedAt: Date.now() - 200_000_000,
    }));
    await upsertAgentRecord(meshDir, record("fresh"));
    await pruneStaleRecords(meshDir);
    const records = await loadAgentRecords(meshDir);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("fresh");
  });
});

describe("per-meshDir write queue isolation", () => {
  test("independent meshDirs do not serialize against each other", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "state2-"));
    try {
      // Writes to two different meshDirs should both succeed independently
      await Promise.all([
        upsertAgentRecord(meshDir, record("a1")),
        upsertAgentRecord(dir2, record("b1")),
      ]);
      const r1 = await loadAgentRecords(meshDir);
      const r2 = await loadAgentRecords(dir2);
      expect(r1).toHaveLength(1);
      expect(r1[0].id).toBe("a1");
      expect(r2).toHaveLength(1);
      expect(r2[0].id).toBe("b1");
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

describe("loadAgentRecords", () => {
  test("returns empty array for missing file", async () => {
    const records = await loadAgentRecords(meshDir);
    expect(records).toEqual([]);
  });
});
