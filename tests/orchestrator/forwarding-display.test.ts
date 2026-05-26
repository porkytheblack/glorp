import { describe, test, expect } from "bun:test";
import {
  ForwardingDisplayManager,
  type ForwardedSlot,
} from "../../src/orchestrator/forwarding-display.ts";

function createDM(agentId = "test-agent") {
  const forwarded: ForwardedSlot[] = [];
  const dm = new ForwardingDisplayManager(agentId, (slot) => forwarded.push(slot));
  return { dm, forwarded };
}

describe("ForwardingDisplayManager", () => {
  describe("pushAndWait — permission_request", () => {
    test("forwards slot via callback", async () => {
      const { dm, forwarded } = createDM();
      const promise = dm.pushAndWait({
        renderer: "permission_request",
        input: { tool: "bash" },
      } as any);

      expect(forwarded).toHaveLength(1);
      expect(forwarded[0].renderer).toBe("permission_request");
      expect(forwarded[0].input).toEqual({ tool: "bash" });
      expect(forwarded[0].agentId).toBe("test-agent");
      expect(dm.pendingCount).toBe(1);

      dm.resolve(forwarded[0].slotId, true);
      await expect(promise).resolves.toBe(true);
    });

    test("slotId includes agent id", async () => {
      const { dm, forwarded } = createDM("my-agent");
      dm.pushAndWait({ renderer: "permission_request", input: {} } as any);
      expect(forwarded[0].slotId).toContain("my-agent");
    });

    test("multiple concurrent slots tracked independently", async () => {
      const { dm, forwarded } = createDM();
      const p1 = dm.pushAndWait({ renderer: "permission_request", input: { n: 1 } } as any);
      const p2 = dm.pushAndWait({ renderer: "permission_request", input: { n: 2 } } as any);

      expect(dm.pendingCount).toBe(2);
      expect(forwarded).toHaveLength(2);

      dm.resolve(forwarded[1].slotId, "second");
      dm.resolve(forwarded[0].slotId, "first");

      await expect(p1).resolves.toBe("first");
      await expect(p2).resolves.toBe("second");
    });
  });

  describe("pushAndWait — non-permission", () => {
    test("rejects ask_choice", async () => {
      const { dm } = createDM();
      await expect(
        dm.pushAndWait({ renderer: "ask_choice", input: {} } as any),
      ).rejects.toThrow("non-permission");
    });

    test("rejects arbitrary renderer", async () => {
      const { dm } = createDM();
      await expect(
        dm.pushAndWait({ renderer: "custom_ui", input: {} } as any),
      ).rejects.toThrow("non-permission");
    });
  });

  describe("resolve", () => {
    test("settles the pending promise", async () => {
      const { dm, forwarded } = createDM();
      const p = dm.pushAndWait({ renderer: "permission_request", input: {} } as any);
      dm.resolve(forwarded[0].slotId, "granted");
      await expect(p).resolves.toBe("granted");
      expect(dm.pendingCount).toBe(0);
    });

    test("no-ops for unknown slotId", () => {
      const { dm } = createDM();
      expect(() => dm.resolve("nonexistent", true)).not.toThrow();
    });

    test("double resolve is safe", async () => {
      const { dm, forwarded } = createDM();
      const p = dm.pushAndWait({ renderer: "permission_request", input: {} } as any);
      dm.resolve(forwarded[0].slotId, true);
      dm.resolve(forwarded[0].slotId, false);
      await expect(p).resolves.toBe(true);
    });
  });

  describe("reject", () => {
    test("rejects the pending promise", async () => {
      const { dm, forwarded } = createDM();
      const p = dm.pushAndWait({ renderer: "permission_request", input: {} } as any);
      dm.reject(forwarded[0].slotId, new Error("denied"));
      await expect(p).rejects.toThrow("denied");
      expect(dm.pendingCount).toBe(0);
    });

    test("no-ops for unknown slotId", () => {
      const { dm } = createDM();
      expect(() => dm.reject("nonexistent", new Error("x"))).not.toThrow();
    });
  });

  describe("hasPending", () => {
    test("true while pending", () => {
      const { dm, forwarded } = createDM();
      dm.pushAndWait({ renderer: "permission_request", input: {} } as any);
      expect(dm.hasPending(forwarded[0].slotId)).toBe(true);
    });

    test("false after resolution", async () => {
      const { dm, forwarded } = createDM();
      const p = dm.pushAndWait({ renderer: "permission_request", input: {} } as any);
      dm.resolve(forwarded[0].slotId, true);
      await p;
      expect(dm.hasPending(forwarded[0].slotId)).toBe(false);
    });

    test("false for unknown slotId", () => {
      const { dm } = createDM();
      expect(dm.hasPending("nonexistent")).toBe(false);
    });
  });

  describe("clearStack", () => {
    test("rejects all pending promises", async () => {
      const { dm } = createDM();
      const p1 = dm.pushAndWait({ renderer: "permission_request", input: {} } as any).catch((e: Error) => e);
      const p2 = dm.pushAndWait({ renderer: "permission_request", input: {} } as any).catch((e: Error) => e);

      await dm.clearStack();

      const r1 = await p1;
      const r2 = await p2;
      expect(r1).toBeInstanceOf(Error);
      expect((r1 as Error).message).toContain("cleared");
      expect((r2 as Error).message).toContain("cleared");
      expect(dm.pendingCount).toBe(0);
    });

    test("safe to call with no pending", async () => {
      const { dm } = createDM();
      await expect(dm.clearStack()).resolves.toBeUndefined();
    });
  });

  describe("pushAndForget", () => {
    test("returns id without forwarding", async () => {
      const { dm, forwarded } = createDM();
      const id = await dm.pushAndForget({ renderer: "test", input: {} } as any);
      expect(id).toMatch(/^fwd_/);
      expect(forwarded).toHaveLength(0);
    });
  });
});
