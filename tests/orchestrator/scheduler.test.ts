import { describe, test, expect } from "bun:test";
import { Displaymanager } from "glove-core/display-manager";
import { Scheduler } from "../../src/orchestrator/scheduler.ts";
import {
  agentId,
  type OrchestratorEvent,
  type ManagedAgent,
  type AgentBlueprint,
  type Slot,
} from "../../src/orchestrator/types.ts";

function makeBp(id: string): AgentBlueprint {
  return { id: agentId(id), label: id, role: "generator", systemPrompt: "", tools: [] };
}

function makeManaged(id: string): ManagedAgent {
  return {
    id: agentId(id),
    blueprint: makeBp(id),
    slot: "background" as Slot,
    runId: `run_${id}`,
    abortController: new AbortController(),
  };
}

function setup() {
  const display = new Displaymanager();
  const events: OrchestratorEvent[] = [];
  const scheduler = new Scheduler(display, (e) => events.push(e));
  return { scheduler, display, events };
}

describe("Scheduler", () => {
  describe("register", () => {
    test("foreground agent", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "foreground");
      expect(scheduler.isForeground(agentId("a"))).toBe(true);
      expect(scheduler.currentForeground).toBe("a");
      expect(scheduler.totalAgents).toBe(1);
    });

    test("background agent", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "background");
      expect(scheduler.isForeground(agentId("a"))).toBe(false);
      expect(scheduler.backgroundCount).toBe(1);
    });

    test("second foreground demotes first", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "foreground");
      scheduler.register(makeManaged("b"), "foreground");
      expect(scheduler.isForeground(agentId("b"))).toBe(true);
      expect(scheduler.isForeground(agentId("a"))).toBe(false);
      expect(scheduler.backgroundCount).toBe(1);
    });
  });

  describe("unregister", () => {
    test("removes foreground agent", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "foreground");
      scheduler.unregister(agentId("a"));
      expect(scheduler.currentForeground).toBeNull();
      expect(scheduler.totalAgents).toBe(0);
    });

    test("removes background agent", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "background");
      scheduler.unregister(agentId("a"));
      expect(scheduler.backgroundCount).toBe(0);
    });

    test("removing foreground drains promotion queue", () => {
      const { scheduler, events } = setup();
      scheduler.register(makeManaged("fg"), "foreground");
      scheduler.register(makeManaged("bg"), "background");
      scheduler.requestPromotion({ agentId: agentId("bg"), reason: "needs input" });

      scheduler.unregister(agentId("fg"));
      expect(scheduler.isForeground(agentId("bg"))).toBe(true);
      // No slot_switched emitted — the old foreground was unregistered, not demoted
    });

    test("skips stale entries in promotion queue", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("fg"), "foreground");
      scheduler.register(makeManaged("bg1"), "background");
      scheduler.register(makeManaged("bg2"), "background");

      scheduler.requestPromotion({ agentId: agentId("bg1"), reason: "first" });
      scheduler.requestPromotion({ agentId: agentId("bg2"), reason: "second" });

      scheduler.unregister(agentId("bg1"));
      scheduler.unregister(agentId("fg"));

      expect(scheduler.isForeground(agentId("bg2"))).toBe(true);
    });

    test("filters removed agent from promotion queue", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("fg"), "foreground");
      scheduler.register(makeManaged("bg"), "background");
      scheduler.requestPromotion({ agentId: agentId("bg"), reason: "test" });

      scheduler.unregister(agentId("bg"));
      scheduler.unregister(agentId("fg"));

      expect(scheduler.currentForeground).toBeNull();
    });
  });

  describe("promote", () => {
    test("background → foreground", () => {
      const { scheduler, events } = setup();
      scheduler.register(makeManaged("a"), "foreground");
      scheduler.register(makeManaged("b"), "background");

      expect(scheduler.promote(agentId("b"))).toBe(true);
      expect(scheduler.isForeground(agentId("b"))).toBe(true);
      expect(scheduler.isForeground(agentId("a"))).toBe(false);

      const switched = events.find((e) => e.type === "slot_switched");
      expect(switched).toBeDefined();
    });

    test("returns false for non-background", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "foreground");
      expect(scheduler.promote(agentId("a"))).toBe(false);
    });

    test("returns false for unknown agent", () => {
      const { scheduler } = setup();
      expect(scheduler.promote(agentId("ghost"))).toBe(false);
    });

    test("promote to empty foreground", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "background");
      expect(scheduler.promote(agentId("a"))).toBe(true);
      expect(scheduler.isForeground(agentId("a"))).toBe(true);
      expect(scheduler.backgroundCount).toBe(0);
    });
  });

  describe("requestPromotion", () => {
    test("immediate when foreground empty", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "background");
      scheduler.requestPromotion({ agentId: agentId("a"), reason: "test" });
      expect(scheduler.isForeground(agentId("a"))).toBe(true);
    });

    test("queues when foreground occupied", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("fg"), "foreground");
      scheduler.register(makeManaged("bg"), "background");
      scheduler.requestPromotion({ agentId: agentId("bg"), reason: "test" });
      expect(scheduler.isForeground(agentId("bg"))).toBe(false);
    });
  });

  describe("displayFor", () => {
    test("foreground returns real display", () => {
      const { scheduler, display } = setup();
      expect(scheduler.displayFor("foreground")).toBe(display);
    });

    test("background returns noop display", () => {
      const { scheduler, display } = setup();
      const bg = scheduler.displayFor("background");
      expect(bg).not.toBe(display);
    });
  });

  describe("accessors", () => {
    test("totalAgents counts all", () => {
      const { scheduler } = setup();
      scheduler.register(makeManaged("a"), "foreground");
      scheduler.register(makeManaged("b"), "background");
      scheduler.register(makeManaged("c"), "background");
      expect(scheduler.totalAgents).toBe(3);
      expect(scheduler.backgroundCount).toBe(2);
    });
  });
});
