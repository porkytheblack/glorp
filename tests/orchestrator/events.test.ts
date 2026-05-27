import { describe, test, expect } from "bun:test";
import { OrchestratorEventBus } from "../../src/orchestrator/events.ts";
import type { OrchestratorEvent } from "../../src/orchestrator/types.ts";

describe("OrchestratorEventBus", () => {
  test("subscribe returns unsubscribe function", () => {
    const bus = new OrchestratorEventBus();
    const events: OrchestratorEvent[] = [];
    const unsub = bus.subscribe((e) => events.push(e));

    bus.emit({ type: "error", message: "first" });
    expect(events).toHaveLength(1);

    unsub();
    bus.emit({ type: "error", message: "second" });
    expect(events).toHaveLength(1);
  });

  test("emits to multiple subscribers", () => {
    const bus = new OrchestratorEventBus();
    const a: OrchestratorEvent[] = [];
    const b: OrchestratorEvent[] = [];

    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.emit({ type: "error", message: "hello" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test("listener error does not break other listeners", () => {
    const bus = new OrchestratorEventBus();
    const events: OrchestratorEvent[] = [];

    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe((e) => events.push(e));

    bus.emit({ type: "error", message: "test" });
    expect(events).toHaveLength(1);
  });

  test("emit with no listeners is safe", () => {
    const bus = new OrchestratorEventBus();
    expect(() => bus.emit({ type: "error", message: "lonely" })).not.toThrow();
  });

  test("double unsubscribe is safe", () => {
    const bus = new OrchestratorEventBus();
    const unsub = bus.subscribe(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  test("events carry correct type discriminant", () => {
    const bus = new OrchestratorEventBus();
    const events: OrchestratorEvent[] = [];
    bus.subscribe((e) => events.push(e));

    bus.emit({ type: "error", message: "err" });
    bus.emit({ type: "plan_created", path: "/plans/x.md", title: "Plan" });

    expect(events[0].type).toBe("error");
    expect(events[1].type).toBe("plan_created");
  });
});
