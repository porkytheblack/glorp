import { describe, test, expect } from "bun:test";
import { NoopDisplayManager } from "../../src/orchestrator/noop-display.ts";

describe("NoopDisplayManager", () => {
  test("pushAndForget returns incrementing IDs", async () => {
    const dm = new NoopDisplayManager();
    const id1 = await dm.pushAndForget({ renderer: "test", input: {} } as any);
    const id2 = await dm.pushAndForget({ renderer: "test", input: {} } as any);
    expect(id1).toBe("noop_slot_1");
    expect(id2).toBe("noop_slot_2");
  });

  test("pushAndWait throws immediately", async () => {
    const dm = new NoopDisplayManager();
    await expect(
      dm.pushAndWait({ renderer: "test", input: {} } as any),
    ).rejects.toThrow("pushAndWait");
  });

  test("pushAndWait error mentions request_promotion", async () => {
    const dm = new NoopDisplayManager();
    try {
      await dm.pushAndWait({ renderer: "test", input: {} } as any);
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("request_promotion");
    }
  });

  test("registerRenderer is a no-op", () => {
    const dm = new NoopDisplayManager();
    expect(() => dm.registerRenderer({} as any)).not.toThrow();
  });

  test("resolve, reject, removeSlot are no-ops", () => {
    const dm = new NoopDisplayManager();
    expect(() => dm.resolve("x", true)).not.toThrow();
    expect(() => dm.reject("x", new Error("e"))).not.toThrow();
    expect(() => dm.removeSlot("x")).not.toThrow();
  });

  test("clearStack resolves", async () => {
    const dm = new NoopDisplayManager();
    await expect(dm.clearStack()).resolves.toBeUndefined();
  });

  test("subscribe returns no-op unsubscribe", () => {
    const dm = new NoopDisplayManager();
    const unsub = dm.subscribe(() => {});
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
  });

  test("counter resets per instance", async () => {
    const dm1 = new NoopDisplayManager();
    const dm2 = new NoopDisplayManager();
    expect(await dm1.pushAndForget({} as any)).toBe("noop_slot_1");
    expect(await dm2.pushAndForget({} as any)).toBe("noop_slot_1");
  });
});
