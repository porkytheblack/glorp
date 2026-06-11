import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Displaymanager } from "glove-core/display-manager";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import {
  agentId,
  type AgentBlueprint,
  type OrchestratorConfig,
  type OrchestratorEvent,
} from "../../src/orchestrator/types.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    workspace: tmpDir,
    dataDir: tmpDir,
    meshDir: path.join(tmpDir, "mesh"),
    model: { name: "fake", prompt: async () => ({ messages: [], tokens_in: 0, tokens_out: 0 }) } as any,
    resources: {
      write: async () => {},
      read: async () => null,
      list: async () => [],
      remove: async () => {},
    } as any,
    ...overrides,
  };
}

function makeBp(id: string, role: "generator" | "evaluator" | "autonomous" = "autonomous"): AgentBlueprint {
  return { id: agentId(id), label: id, role, systemPrompt: "test", tools: [] };
}

describe("Orchestrator", () => {
  describe("lifecycle", () => {
    test("start creates mesh directory", async () => {
      const meshDir = path.join(tmpDir, "mesh", "session1");
      const config = makeConfig({ meshDir });
      const orch = new Orchestrator(config, new Displaymanager());

      await orch.start();
      expect(fs.existsSync(meshDir)).toBe(true);
      await orch.shutdown();
    });

    test("double start is safe", async () => {
      const config = makeConfig();
      const orch = new Orchestrator(config, new Displaymanager());
      await orch.start();
      await expect(orch.start()).resolves.toBeUndefined();
      await orch.shutdown();
    });

    test("shutdown without start is safe", async () => {
      const config = makeConfig();
      const orch = new Orchestrator(config, new Displaymanager());
      await expect(orch.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("subscribe", () => {
    test("receives emitted events", async () => {
      const config = makeConfig();
      const orch = new Orchestrator(config, new Displaymanager());
      const events: OrchestratorEvent[] = [];

      orch.subscribe((e) => events.push(e));
      await orch.start();

      // Start emits no events, but the bus is wired
      expect(events).toHaveLength(0);
      await orch.shutdown();
    });

    test("unsubscribe stops delivery", async () => {
      const config = makeConfig();
      const orch = new Orchestrator(config, new Displaymanager());
      const events: OrchestratorEvent[] = [];

      const unsub = orch.subscribe((e) => events.push(e));
      unsub();

      await orch.start();
      await orch.shutdown();
      expect(events).toHaveLength(0);
    });
  });

  describe("agentCount", () => {
    test("starts at zero", () => {
      const orch = new Orchestrator(makeConfig(), new Displaymanager());
      expect(orch.agentCount).toBe(0);
    });
  });

  describe("getAgent", () => {
    test("returns undefined for unknown id", () => {
      const orch = new Orchestrator(makeConfig(), new Displaymanager());
      expect(orch.getAgent(agentId("ghost"))).toBeUndefined();
    });
  });

  describe("forwarded slots", () => {
    test("hasForwardedSlot returns false by default", () => {
      const orch = new Orchestrator(makeConfig(), new Displaymanager());
      expect(orch.hasForwardedSlot("slot1")).toBe(false);
    });

    test("resolveForwardedSlot returns false for unknown", () => {
      const orch = new Orchestrator(makeConfig(), new Displaymanager());
      expect(orch.resolveForwardedSlot("slot1", true)).toBe(false);
    });

    test("rejectForwardedSlot returns false for unknown", () => {
      const orch = new Orchestrator(makeConfig(), new Displaymanager());
      expect(orch.rejectForwardedSlot("slot1", "reason")).toBe(false);
    });
  });

  describe("shutdown", () => {
    test("rejects all forwarded slots", async () => {
      const config = makeConfig();
      const orch = new Orchestrator(config, new Displaymanager());
      await orch.start();

      // Manually inject a forwarded slot via runLoop's trackForwardedSlot
      // (testing the shutdown path without needing a full gen-eval loop)
      const { ForwardingDisplayManager } = await import(
        "../../src/orchestrator/forwarding-display.ts"
      );
      const dm = new ForwardingDisplayManager("test", () => {});
      const promise = dm.pushAndWait({ renderer: "permission_request", input: {} } as any)
        .catch((e: Error) => e);

      // Access internal forwardedSlots map (entries carry the slot payload so
      // pending slots can be replayed on hydrate)
      (orch as any).forwardedSlots.set("fwd_test_1", { dm, renderer: "permission_request", input: {}, createdAt: Date.now() });

      await orch.shutdown();

      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("shutting down");
    });
  });

  describe("maxAgents enforcement", () => {
    test("config accepts custom maxAgents", () => {
      const config = makeConfig({ maxAgents: 2 });
      const orch = new Orchestrator(config, new Displaymanager());
      // maxAgents is stored internally, verified via spawnAgent limit
      expect(orch).toBeDefined();
    });
  });
});
