/**
 * Tests for the synchronous message endpoint's event collection logic.
 * Uses a mock GlorpHandle + Bridge to verify the collector assembles
 * the response correctly from bridge events.
 */

import { describe, it, expect } from "bun:test";
import { handleSendMessage } from "../src/server/message-endpoint.ts";
import { Bridge } from "../src/shared/bridge.ts";
import type { BridgeEvent, ChatTurn, ToolEvent } from "../src/shared/events.ts";
import type { GlorpHandle } from "../src/agent/glorp-types.ts";

function makeTurn(kind: ChatTurn["kind"], text?: string): ChatTurn {
  return { id: `t_${Date.now()}`, kind, text, createdAt: Date.now() };
}

function makeTool(name: string, status: ToolEvent["status"] = "running"): ToolEvent {
  return { id: `tool_${name}`, name, input: {}, status, startedAt: Date.now() };
}

function mockHandle(bridge: Bridge): GlorpHandle {
  return {
    send: async () => {},
    resolvePermission: () => {},
    resolveSlot: () => {},
    rejectSlot: () => {},
    abort: () => {},
  } as unknown as GlorpHandle;
}

describe("handleSendMessage", () => {
  it("collects text and turns from a simple exchange", async () => {
    const bridge = new Bridge();
    const handle = mockHandle(bridge);

    // Override send to emit a fake agent response
    (handle as any).send = async () => {
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "turn", turn: makeTurn("user", "hello") });
      bridge.emit({ type: "text_delta", text: "Hi " });
      bridge.emit({ type: "text_delta", text: "there!" });
      bridge.emit({ type: "turn", turn: makeTurn("agent", "Hi there!") });
      bridge.emit({ type: "busy", busy: false });
    };

    const resp = await handleSendMessage(handle, bridge, { text: "hello" });

    expect(resp.error).toBeNull();
    expect(resp.text).toBe("Hi there!");
    expect(resp.turns.length).toBe(2);
    expect(resp.turns[1]!.kind).toBe("agent");
    expect(resp.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("collects tool events", async () => {
    const bridge = new Bridge();
    const handle = mockHandle(bridge);

    (handle as any).send = async () => {
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "tool_started", tool: makeTool("read") });
      bridge.emit({ type: "tool_finished", tool: { ...makeTool("read", "success"), id: "tool_read", output: "file contents" } });
      bridge.emit({ type: "turn", turn: makeTurn("agent", "Done") });
      bridge.emit({ type: "busy", busy: false });
    };

    const resp = await handleSendMessage(handle, bridge, { text: "read" });

    expect(resp.tools.length).toBe(1);
    expect(resp.tools[0]!.name).toBe("read");
    expect(resp.tools[0]!.status).toBe("success");
  });

  it("captures error events", async () => {
    const bridge = new Bridge();
    const handle = mockHandle(bridge);

    (handle as any).send = async () => {
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "error", message: "model exploded" });
      bridge.emit({ type: "busy", busy: false });
    };

    const resp = await handleSendMessage(handle, bridge, { text: "boom" });

    expect(resp.error).toBe("model exploded");
    expect(resp.text).toBeNull();
  });

  it("times out when busy:false never fires", async () => {
    const bridge = new Bridge();
    const handle = mockHandle(bridge);

    (handle as any).send = async () => {
      bridge.emit({ type: "busy", busy: true });
      // Never emits busy: false
    };

    const resp = await handleSendMessage(handle, bridge, {
      text: "hang",
      timeout_ms: 200,
    });

    expect(resp.error).toBe("Request timed out");
  });

  it("ignores busy:false before busy:true (previous request cleanup)", async () => {
    const bridge = new Bridge();
    const handle = mockHandle(bridge);

    (handle as any).send = async () => {
      // Stale busy:false from a previous aborted request
      bridge.emit({ type: "busy", busy: false });
      // Real cycle
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "turn", turn: makeTurn("agent", "correct") });
      bridge.emit({ type: "busy", busy: false });
    };

    const resp = await handleSendMessage(handle, bridge, { text: "test" });

    expect(resp.text).toBe("correct");
    expect(resp.error).toBeNull();
  });

  it("auto-approves permission slots when enabled", async () => {
    const bridge = new Bridge();
    const handle = mockHandle(bridge);
    const approved: string[] = [];
    (handle as any).resolvePermission = (id: string, allow: boolean) => {
      if (allow) approved.push(id);
    };

    (handle as any).send = async () => {
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({
        type: "display_slot_pushed",
        slot: { slotId: "perm_1", renderer: "permission", input: {}, createdAt: Date.now(), isPermissionRequest: true },
      } as BridgeEvent);
      // Yield so the deferred setTimeout(0) fires before busy:false
      await new Promise((r) => setTimeout(r, 10));
      bridge.emit({ type: "turn", turn: makeTurn("agent", "done") });
      bridge.emit({ type: "busy", busy: false });
    };

    await handleSendMessage(handle, bridge, { text: "do thing", auto_approve: true });
    expect(approved).toEqual(["perm_1"]);
  });

  it("falls back to streamed text when no agent turn has text", async () => {
    const bridge = new Bridge();
    const handle = mockHandle(bridge);

    (handle as any).send = async () => {
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "text_delta", text: "streamed " });
      bridge.emit({ type: "text_delta", text: "only" });
      bridge.emit({ type: "busy", busy: false });
    };

    const resp = await handleSendMessage(handle, bridge, { text: "test" });
    expect(resp.text).toBe("streamed only");
  });
});
