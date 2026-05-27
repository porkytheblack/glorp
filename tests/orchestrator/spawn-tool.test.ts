import { describe, test, expect } from "bun:test";
import { spawnAgentTool } from "../../src/orchestrator/spawn-tool.ts";
import type { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { agentId, type ManagedAgent, type AgentBlueprint, type Slot } from "../../src/orchestrator/types.ts";

function mockOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    spawnAgent: async (bp: AgentBlueprint, slot: Slot, task: string): Promise<ManagedAgent> => ({
      id: bp.id,
      blueprint: bp,
      slot,
      runId: `run_${bp.id}`,
      abortController: new AbortController(),
    }),
    ...overrides,
  } as Orchestrator;
}

describe("spawnAgentTool", () => {
  test("has correct metadata", () => {
    const tool = spawnAgentTool(mockOrchestrator(), "/tmp/ws");
    expect(tool.name).toBe("spawn_agent");
    expect(tool.requiresPermission).toBe(true);
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
  });

  describe("do()", () => {
    test("spawns agent and returns success", async () => {
      const orch = mockOrchestrator();
      const tool = spawnAgentTool(orch, "/tmp/ws");

      const result = await tool.do!({
        label: "test-agent",
        role: "builder",
        task: "build something",
      });

      expect(result.status).toBe("success");
      expect(result.data).toContain("test-agent");
      expect(result.data).toContain("builder");
    });

    test("defaults to background slot", async () => {
      let capturedSlot: Slot | undefined;
      const orch = mockOrchestrator({
        spawnAgent: async (bp, slot) => {
          capturedSlot = slot;
          return { id: bp.id, blueprint: bp, slot, runId: "r", abortController: new AbortController() };
        },
      } as any);

      const tool = spawnAgentTool(orch, "/tmp/ws");
      await tool.do!({ label: "bg", role: "researcher", task: "research" });
      expect(capturedSlot).toBe("background");
    });

    test("respects explicit foreground slot", async () => {
      let capturedSlot: Slot | undefined;
      const orch = mockOrchestrator({
        spawnAgent: async (bp, slot) => {
          capturedSlot = slot;
          return { id: bp.id, blueprint: bp, slot, runId: "r", abortController: new AbortController() };
        },
      } as any);

      const tool = spawnAgentTool(orch, "/tmp/ws");
      await tool.do!({ label: "fg", role: "generator", task: "generate", slot: "foreground" });
      expect(capturedSlot).toBe("foreground");
    });

    test("handles all four roles", async () => {
      const orch = mockOrchestrator();
      const tool = spawnAgentTool(orch, "/tmp/ws");

      for (const role of ["generator", "evaluator", "researcher", "builder"] as const) {
        const result = await tool.do!({ label: `${role}-test`, role, task: "do something" });
        expect(result.status).toBe("success");
      }
    });

    test("overrides tools when provided", async () => {
      let capturedBp: AgentBlueprint | undefined;
      const orch = mockOrchestrator({
        spawnAgent: async (bp) => {
          capturedBp = bp;
          return { id: bp.id, blueprint: bp, slot: "background", runId: "r", abortController: new AbortController() };
        },
      } as any);

      const tool = spawnAgentTool(orch, "/tmp/ws");
      await tool.do!({
        label: "custom",
        role: "builder",
        task: "build",
        tools: ["read", "write"],
      });

      expect(capturedBp!.tools).toEqual(["read", "write"]);
    });

    test("returns error on spawn failure", async () => {
      const orch = mockOrchestrator({
        spawnAgent: async () => { throw new Error("limit reached"); },
      } as any);

      const tool = spawnAgentTool(orch, "/tmp/ws");
      const result = await tool.do!({ label: "fail", role: "builder", task: "x" });

      expect(result.status).toBe("error");
      expect(result.message).toContain("limit reached");
    });

    test("result includes renderData", async () => {
      const orch = mockOrchestrator();
      const tool = spawnAgentTool(orch, "/tmp/ws");
      const result = await tool.do!({ label: "viz", role: "researcher", task: "research" });

      expect((result as any).renderData).toBeDefined();
      expect((result as any).renderData.label).toBe("viz");
      expect((result as any).renderData.role).toBe("researcher");
    });
  });
});
