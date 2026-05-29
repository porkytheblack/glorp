/**
 * Integration tests for the conversational-agent roster: add / switch / remove,
 * per-agent transcript isolation, roster + hydrate events, and persistence.
 *
 * Exercises the real GlorpHandle (buildGlorp) with temp dirs. The model is
 * never invoked (no send()), so no network/credentials are required —
 * sk-test satisfies the provider builder, matching tests/agent.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildGlorp } from "../src/agent/glorp.ts";
import { resolveSessionPaths, agentStoreFile } from "../src/agent/session-paths.ts";
import { getBridge } from "../src/shared/bridge.ts";
import type { GlorpHandle } from "../src/agent/glorp-types.ts";
import type { BridgeEvent } from "../src/shared/events.ts";

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-test";

let dataDir: string;
let workspace: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-roster-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-roster-ws-"));
});

afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
});

function captureRoster() {
  const events: BridgeEvent[] = [];
  const unsub = getBridge().subscribe((e) => events.push(e));
  return {
    unsub,
    lastRoster: () => [...events].reverse().find((e) => e.type === "agent_roster") as Extract<BridgeEvent, { type: "agent_roster" }> | undefined,
    hydrateCount: () => events.filter((e) => e.type === "session_hydrate").length,
  };
}

describe("conversational agent roster", () => {
  test("starts with a single 'main' agent", async () => {
    const g = await buildGlorp({ workspace, sessionId: "roster-1", dataDir });
    try {
      const cap = captureRoster();
      await g.hydrateUi();
      expect(g.activeAgentId).toBe("main");
      const agents = g.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]!.id).toBe("main");
      expect(agents[0]!.active).toBe(true);
      // hydrate emits a roster event for connecting clients
      expect(cap.lastRoster()?.activeId).toBe("main");
      cap.unsub();
    } finally { await g.shutdown(); }
  });

  test("addAgent creates a new agent, switches to it, and clears the transcript", async () => {
    const g = await buildGlorp({ workspace, sessionId: "roster-2", dataDir });
    try {
      const cap = captureRoster();
      const id = await g.addAgent({ role: "researcher", label: "scout" });
      expect(g.activeAgentId).toBe(id);
      const agents = g.listAgents();
      expect(agents).toHaveLength(2);
      const created = agents.find((a) => a.id === id)!;
      expect(created.role).toBe("researcher");
      expect(created.label).toBe("scout");
      expect(created.active).toBe(true);
      // switching to a fresh agent hydrates an (empty) transcript
      expect(cap.hydrateCount()).toBeGreaterThanOrEqual(1);
      expect(cap.lastRoster()?.activeId).toBe(id);
      cap.unsub();
    } finally { await g.shutdown(); }
  });

  test("each agent keeps its own transcript across switches", async () => {
    const g = await buildGlorp({ workspace, sessionId: "roster-3", dataDir });
    try {
      const id = await g.addAgent({ role: "researcher" });
      // active store is now the researcher's — append a message to it
      await g.store.appendMessages([{ sender: "user", text: "find the bug" } as any]);
      let msgs = await g.store.getDisplayMessages();
      expect(msgs.some((m) => m.text === "find the bug")).toBe(true);

      // switch back to main — its transcript must NOT contain the researcher's message
      await g.switchAgent("main");
      expect(g.activeAgentId).toBe("main");
      msgs = await g.store.getDisplayMessages();
      expect(msgs.some((m) => m.text === "find the bug")).toBe(false);

      // switch back to the researcher — its message is still there
      await g.switchAgent(id);
      msgs = await g.store.getDisplayMessages();
      expect(msgs.some((m) => m.text === "find the bug")).toBe(true);
    } finally { await g.shutdown(); }
  });

  test("removeAgent deletes a non-active agent; the active/main cannot be orphaned", async () => {
    const g = await buildGlorp({ workspace, sessionId: "roster-4", dataDir });
    try {
      const id = await g.addAgent({ role: "reviewer" });
      const storeFile = agentStoreFile(resolveSessionPaths(dataDir, "roster-4"), id);
      await g.store.appendMessages([{ sender: "user", text: "review this" } as any]);
      await g.store.flush?.();
      expect(fs.existsSync(storeFile)).toBe(true); // agent transcript was created

      // removing the active agent switches to main first, then deletes it
      await g.removeAgent(id);
      expect(g.activeAgentId).toBe("main");
      expect(g.listAgents()).toHaveLength(1);
      expect(fs.existsSync(storeFile)).toBe(false); // and its storage is gone

      // 'main' is protected
      await g.removeAgent("main");
      expect(g.listAgents().some((a) => a.id === "main")).toBe(true);
    } finally { await g.shutdown(); }
  });

  test("roster persists to disk and survives a rebuild", async () => {
    const g1 = await buildGlorp({ workspace, sessionId: "roster-5", dataDir });
    let id: string;
    try {
      id = await g1.addAgent({ role: "planner", label: "architect" });
      await g1.switchAgent("main");
    } finally { await g1.shutdown(); }

    const rosterFile = resolveSessionPaths(dataDir, "roster-5").rosterFile;
    expect(fs.existsSync(rosterFile)).toBe(true);

    // a fresh handle for the same session reloads the roster
    const g2 = await buildGlorp({ workspace, sessionId: "roster-5", dataDir });
    try {
      const agents = g2.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.some((a) => a.id === id && a.label === "architect")).toBe(true);
      expect(g2.activeAgentId).toBe("main");
    } finally { await g2.shutdown(); }
  });
});
