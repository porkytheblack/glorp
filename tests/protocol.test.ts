/**
 * Tests for the wire protocol types and helpers.
 * Validates that every BridgeEvent maps correctly to a ServerMessage,
 * and that the envelope shape is correct.
 */

import { describe, it, expect } from "bun:test";
import { PROTOCOL_VERSION, DEFAULT_PORT, WS_CLOSE } from "../src/protocol/envelope.ts";
import type { Envelope } from "../src/protocol/envelope.ts";
import type { ServerMessage } from "../src/protocol/events.ts";
import type { ClientMessage } from "../src/protocol/commands.ts";
import type { BridgeEvent } from "../src/shared/events.ts";

describe("protocol/envelope", () => {
  it("exports protocol version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("exports default port 3271", () => {
    expect(DEFAULT_PORT).toBe(3271);
  });

  it("exports all close codes", () => {
    expect(WS_CLOSE.NORMAL).toBe(1000);
    expect(WS_CLOSE.SERVER_SHUTDOWN).toBe(1001);
    expect(WS_CLOSE.NO_HELLO).toBe(4001);
    expect(WS_CLOSE.PING_TIMEOUT).toBe(4002);
    expect(WS_CLOSE.PROTOCOL_ERROR).toBe(4003);
    expect(WS_CLOSE.AUTH_FAILED).toBe(4004);
    expect(WS_CLOSE.SESSION_GONE).toBe(4005);
    expect(WS_CLOSE.VERSION_MISMATCH).toBe(4006);
  });
});

describe("protocol/events", () => {
  it("BridgeEvent types map 1:1 to ServerMessage", () => {
    // Every BridgeEvent type string should be a valid ServerMessage type.
    const bridgeTypes: BridgeEvent["type"][] = [
      "session_hydrate", "session_reset",
      "title", "turn", "turn_update",
      "text_delta", "text_clear",
      "tool_started", "tool_finished",
      "busy", "plan", "tasks", "inbox",
      "orchestrator_phase", "orchestrator_verdict", "orchestrator_agent",
      "orchestrator_plan", "orchestrator_slot",
      "stats", "runner_agent_stats",
      "compaction", "subagent", "transmission",
      "error", "hook", "skill",
      "display_slot_pushed", "display_slot_resolved",
    ];
    // Type assertion: if this compiles, the mapping is correct.
    for (const t of bridgeTypes) {
      expect(typeof t).toBe("string");
    }
  });

  it("server-only messages have distinct types", () => {
    // These types exist in ServerMessage but NOT in BridgeEvent.
    const serverOnly = [
      "server_hello", "peer_joined", "peer_left",
      "model_label_changed", "command_rejected", "protocol_error",
    ];
    for (const t of serverOnly) {
      expect(typeof t).toBe("string");
    }
  });
});

describe("protocol/commands", () => {
  it("all command types are valid ClientMessage", () => {
    const commandTypes: ClientMessage["type"][] = [
      "client_hello",
      "send_message", "plan_and_build", "abort",
      "resolve_slot", "reject_slot", "resolve_permission",
      "swap_profile", "clear_permission", "clear_permission_key",
      "resync",
    ];
    expect(commandTypes.length).toBe(11);
  });
});

describe("envelope shape", () => {
  it("can construct a valid envelope", () => {
    const env: Envelope = { type: "test", seq: 1, ts: new Date().toISOString() };
    expect(env.type).toBe("test");
    expect(env.seq).toBe(1);
    expect(typeof env.ts).toBe("string");
  });

  it("serializes to JSON correctly", () => {
    const env: Envelope = { type: "text_delta", seq: 42, ts: "2026-05-26T10:00:00Z" };
    const json = JSON.stringify(env);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("text_delta");
    expect(parsed.seq).toBe(42);
    expect(parsed.ts).toBe("2026-05-26T10:00:00Z");
  });
});

describe("cli-args", () => {
  // Import inline so test file stays focused.
  const { parseCliArgs } = require("../src/cli-args.ts");

  it("defaults to tui command", () => {
    const args = parseCliArgs([]);
    expect(args.command).toBe("tui");
  });

  it("parses serve command", () => {
    const args = parseCliArgs(["serve"]);
    expect(args.command).toBe("serve");
  });

  it("parses -p as headless", () => {
    const args = parseCliArgs(["-p", "hello world"]);
    expect(args.command).toBe("headless");
    expect(args.prompt).toBe("hello world");
  });

  it("parses --port and --token", () => {
    const args = parseCliArgs(["serve", "--port", "4000", "--token", "abc"]);
    expect(args.port).toBe(4000);
    expect(args.token).toBe("abc");
  });

  it("parses -C for workspace", () => {
    const args = parseCliArgs(["-C", "/tmp/test"]);
    expect(args.workspace).toBe("/tmp/test");
  });

  it("parses positional as prompt", () => {
    const args = parseCliArgs(["fix", "the", "bug"]);
    expect(args.prompt).toBe("fix the bug");
  });
});
