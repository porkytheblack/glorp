/**
 * Agent busy-awareness: processing-state persistence in the mesh roster +
 * the list_agents tool that lets agents see who is busy.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  upsertAgentRecord, setAgentState, markAgentStopped, loadAgentRecords,
} from "../src/orchestrator/agent-state.ts";
import { agentId } from "../src/orchestrator/types.ts";
import { listAgentsTool } from "../src/agent/tools/list-agents.ts";

let meshDir: string;
beforeEach(() => { meshDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-mesh-")); });
afterEach(() => { try { fs.rmSync(meshDir, { recursive: true, force: true }); } catch {} });

async function seed(id: string, label: string, role: string) {
  await upsertAgentRecord(meshDir, {
    id, label, role, slot: "background", status: "running",
    state: "thinking", stateSince: Date.now(), runId: `run_${id}`, spawnedAt: Date.now(),
  });
}

describe("processing state in the mesh roster", () => {
  test("setAgentState transitions a live agent", async () => {
    await seed("a1", "scout", "researcher");
    await setAgentState(meshDir, agentId("a1"), "working");
    const recs = await loadAgentRecords(meshDir);
    expect(recs.find((r) => r.id === "a1")?.state).toBe("working");
  });

  test("markAgentStopped sets done on success, dead on failure", async () => {
    await seed("ok", "builder", "builder");
    await seed("bad", "tester", "evaluator");
    await markAgentStopped(meshDir, agentId("ok"), "completed");
    await markAgentStopped(meshDir, agentId("bad"), "failed: boom");
    const recs = await loadAgentRecords(meshDir);
    expect(recs.find((r) => r.id === "ok")?.state).toBe("done");
    expect(recs.find((r) => r.id === "bad")?.state).toBe("dead");
    expect(recs.find((r) => r.id === "bad")?.status).toBe("stopped");
  });
});

describe("list_agents tool", () => {
  test("reports the roster with states and a busy count", async () => {
    await seed("a1", "scout", "researcher");          // thinking (busy)
    await seed("a2", "critic", "reviewer");
    await markAgentStopped(meshDir, agentId("a2"), "completed"); // done (not busy)

    const res = await listAgentsTool(meshDir).do({});
    expect(res.status).toBe("success");
    const text = String(res.data);
    expect(text).toContain("scout (researcher)");
    expect(text).toContain("critic (reviewer)");
    expect(text).toContain("THINKING");
    expect(text).toContain("DONE");
    expect(text).toMatch(/2 agent\(s\) — 1 busy/);
  });

  test("handles an empty roster and a missing mesh dir", async () => {
    const empty = await listAgentsTool(meshDir).do({});
    expect(String(empty.data)).toMatch(/No other agents/);
    const none = await listAgentsTool(undefined).do({});
    expect(String(none.data)).toMatch(/No agent roster/);
  });
});
