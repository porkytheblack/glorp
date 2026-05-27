/**
 * Integration tests for the Glorp server + client SDK.
 * Verifies the full protocol: REST session management, WebSocket
 * connection lifecycle, and event relay.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Broadcaster, type WsClient } from "../src/server/broadcast.ts";
import { dispatchCommand } from "../src/server/dispatch.ts";
import { serverMessageToBridgeEvent } from "../src/client/bridge-adapter.ts";
import { parseCliArgs } from "../src/cli-args.ts";
import type { BridgeEvent } from "../src/shared/events.ts";
import type { ServerMessage } from "../src/protocol/events.ts";
import { PROTOCOL_VERSION, WS_CLOSE } from "../src/protocol/envelope.ts";

describe("Broadcaster", () => {
  it("adds and removes clients", () => {
    const b = new Broadcaster();
    const sent: string[] = [];
    const mock: WsClient = { id: "c1", ws: { send: (d) => sent.push(d), readyState: 1 }, seq: 0 };
    b.addClient(mock);
    expect(b.clientCount).toBe(1);
    expect(b.clientIds).toEqual(["c1"]);
    b.removeClient("c1");
    expect(b.clientCount).toBe(0);
  });

  it("broadcasts to all connected clients", () => {
    const b = new Broadcaster();
    const sent1: string[] = [];
    const sent2: string[] = [];
    b.addClient({ id: "a", ws: { send: (d) => sent1.push(d), readyState: 1 }, seq: 0 });
    b.addClient({ id: "b", ws: { send: (d) => sent2.push(d), readyState: 1 }, seq: 0 });
    b.broadcast({ type: "busy", busy: true } as BridgeEvent);
    expect(sent1.length).toBe(1);
    expect(sent2.length).toBe(1);
    const msg1 = JSON.parse(sent1[0]!);
    const msg2 = JSON.parse(sent2[0]!);
    expect(msg1.type).toBe("busy");
    expect(msg1.busy).toBe(true);
    expect(msg1.seq).toBe(1);
    expect(msg2.seq).toBe(1);
    expect(typeof msg1.ts).toBe("string");
  });

  it("skips clients with closed sockets", () => {
    const b = new Broadcaster();
    const sent: string[] = [];
    b.addClient({ id: "open", ws: { send: (d) => sent.push(d), readyState: 1 }, seq: 0 });
    b.addClient({ id: "closed", ws: { send: () => {}, readyState: 3 }, seq: 0 });
    b.broadcast({ type: "text_clear" } as BridgeEvent);
    expect(sent.length).toBe(1);
  });

  it("increments seq per client across broadcasts", () => {
    const b = new Broadcaster();
    const sent: string[] = [];
    b.addClient({ id: "c", ws: { send: (d) => sent.push(d), readyState: 1 }, seq: 0 });
    b.broadcast({ type: "text_delta", text: "a" } as BridgeEvent);
    b.broadcast({ type: "text_delta", text: "b" } as BridgeEvent);
    expect(JSON.parse(sent[0]!).seq).toBe(1);
    expect(JSON.parse(sent[1]!).seq).toBe(2);
  });

  it("sends peer events to other clients only", () => {
    const b = new Broadcaster();
    const sentA: string[] = [];
    const sentB: string[] = [];
    b.addClient({ id: "a", ws: { send: (d) => sentA.push(d), readyState: 1 }, seq: 0 });
    b.addClient({ id: "b", ws: { send: (d) => sentB.push(d), readyState: 1 }, seq: 0 });
    b.broadcastPeerEvent("peer_joined", "a");
    expect(sentA.length).toBe(0); // origin client excluded
    expect(sentB.length).toBe(1);
    const msg = JSON.parse(sentB[0]!);
    expect(msg.type).toBe("peer_joined");
    expect(msg.client_id).toBe("a");
    expect(msg.peer_count).toBe(2);
  });

  it("survives send errors without crashing", () => {
    const b = new Broadcaster();
    const sent: string[] = [];
    b.addClient({ id: "bad", ws: { send: () => { throw new Error("broken"); }, readyState: 1 }, seq: 0 });
    b.addClient({ id: "good", ws: { send: (d) => sent.push(d), readyState: 1 }, seq: 0 });
    b.broadcast({ type: "text_delta", text: "hello" } as BridgeEvent);
    expect(sent.length).toBe(1);
  });
});

describe("dispatchCommand", () => {
  function mockHandle() {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    return {
      calls,
      handle: {
        send: (...args: unknown[]) => { calls.push({ method: "send", args }); return Promise.resolve(); },
        planAndBuild: (...args: unknown[]) => { calls.push({ method: "planAndBuild", args }); return Promise.resolve(); },
        abort: () => { calls.push({ method: "abort", args: [] }); },
        resolveSlot: (...args: unknown[]) => { calls.push({ method: "resolveSlot", args }); },
        rejectSlot: (...args: unknown[]) => { calls.push({ method: "rejectSlot", args }); },
        resolvePermission: (...args: unknown[]) => { calls.push({ method: "resolvePermission", args }); },
        swapProfile: (...args: unknown[]) => { calls.push({ method: "swapProfile", args }); return Promise.resolve(); },
        clearPermission: (...args: unknown[]) => { calls.push({ method: "clearPermission", args }); return Promise.resolve(); },
        clearPermissionKey: (...args: unknown[]) => { calls.push({ method: "clearPermissionKey", args }); return Promise.resolve(); },
        hydrateUi: () => { calls.push({ method: "hydrateUi", args: [] }); return Promise.resolve(); },
        stopAgent: (...args: unknown[]) => { calls.push({ method: "stopAgent", args }); return Promise.resolve(); },
        promoteAgent: (...args: unknown[]) => { calls.push({ method: "promoteAgent", args }); return false; },
      } as any,
    };
  }

  it("dispatches send_message to handle.send()", () => {
    const { handle, calls } = mockHandle();
    dispatchCommand({ type: "send_message", text: "hello", seq: 1, ts: "" } as any, handle);
    expect(calls).toEqual([{ method: "send", args: ["hello"] }]);
  });

  it("dispatches abort", () => {
    const { handle, calls } = mockHandle();
    dispatchCommand({ type: "abort", seq: 1, ts: "" } as any, handle);
    expect(calls).toEqual([{ method: "abort", args: [] }]);
  });

  it("dispatches resolve_permission", () => {
    const { handle, calls } = mockHandle();
    dispatchCommand({ type: "resolve_permission", slot_id: "s1", allow: true, seq: 1, ts: "" } as any, handle);
    expect(calls).toEqual([{ method: "resolvePermission", args: ["s1", true] }]);
  });

  it("dispatches resync to hydrateUi", () => {
    const { handle, calls } = mockHandle();
    dispatchCommand({ type: "resync", seq: 1, ts: "" } as any, handle);
    expect(calls).toEqual([{ method: "hydrateUi", args: [] }]);
  });

  it("dispatches stop_agent", () => {
    const { handle, calls } = mockHandle();
    dispatchCommand({ type: "stop_agent", agent_id: "a1", reason: "done", seq: 1, ts: "" } as any, handle);
    expect(calls).toEqual([{ method: "stopAgent", args: ["a1", "done"] }]);
  });

  it("dispatches promote_agent", () => {
    const { handle, calls } = mockHandle();
    dispatchCommand({ type: "promote_agent", agent_id: "a1", seq: 1, ts: "" } as any, handle);
    expect(calls).toEqual([{ method: "promoteAgent", args: ["a1"] }]);
  });
});

describe("serverMessageToBridgeEvent", () => {
  it("converts bridge-compatible messages", () => {
    const msg: ServerMessage = { type: "busy", busy: true, seq: 5, ts: "2026-01-01T00:00:00Z" } as any;
    const event = serverMessageToBridgeEvent(msg);
    expect(event).toEqual({ type: "busy", busy: true });
  });

  it("returns null for server-only messages", () => {
    const hello: ServerMessage = {
      type: "server_hello", protocol_version: 1, server_version: "0.1.0",
      session_id: "s1", workspace: "/tmp", peer_count: 0, seq: 1, ts: "",
    } as any;
    expect(serverMessageToBridgeEvent(hello)).toBeNull();
  });

  it("strips seq and ts from bridge events", () => {
    const msg: ServerMessage = {
      type: "text_delta", text: "hello", seq: 42, ts: "2026-01-01",
    } as any;
    const event = serverMessageToBridgeEvent(msg);
    expect(event).toEqual({ type: "text_delta", text: "hello" });
    expect((event as any).seq).toBeUndefined();
    expect((event as any).ts).toBeUndefined();
  });

  it("converts all BridgeEvent types", () => {
    const types = [
      "session_hydrate", "session_reset", "text_delta", "text_clear",
      "turn", "turn_update", "tool_started", "tool_finished",
      "busy", "title", "stats", "compaction", "plan", "tasks", "inbox",
      "subagent", "skill", "hook",
      "display_slot_pushed", "display_slot_resolved",
      "orchestrator_phase", "orchestrator_verdict", "orchestrator_agent",
      "orchestrator_plan", "orchestrator_slot", "runner_agent_stats",
      "transmission", "error",
    ];
    for (const t of types) {
      const result = serverMessageToBridgeEvent({ type: t, seq: 1, ts: "" } as any);
      expect(result).not.toBeNull();
      expect(result!.type).toBe(t);
    }
  });
});

describe("cli-args", () => {
  it("serve command with all options", () => {
    const args = parseCliArgs(["serve", "--port", "4000", "--token", "secret", "-C", "/home/dev"]);
    expect(args.command).toBe("serve");
    expect(args.port).toBe(4000);
    expect(args.token).toBe("secret");
    expect(args.workspace).toBe("/home/dev");
  });

  it("model and provider flags", () => {
    const args = parseCliArgs(["--provider", "openai", "-m", "gpt-4o", "fix the bug"]);
    expect(args.provider).toBe("openai");
    expect(args.model).toBe("gpt-4o");
    expect(args.prompt).toBe("fix the bug");
  });
});
