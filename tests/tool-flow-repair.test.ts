/**
 * Tool-flow repair: aborted turns leave dangling tool_calls and late results
 * out of position; strict providers (Moonshot Kimi) reject the replay. The
 * fixture mirrors a real corrupted session (daring-narwhal-q642).
 */

import { describe, test, expect } from "bun:test";
import { repairToolFlow, toolFlowIsClean } from "../src/agent/runtime/tool-flow-repair.ts";
import type { Message } from "glove-core/core";

const call = (name: string, id: string) => ({ tool_name: name, id, input_args: {} });
const result = (name: string, id: string) => ({ tool_name: name, call_id: id, result: { status: "success" as const, data: "ok" } });
const agentCalls = (...calls: any[]): Message => ({ sender: "agent", text: "", tool_calls: calls, reasoning_content: " " }) as Message;
const results = (...rs: any[]): Message => ({ sender: "user", text: "", tool_results: rs }) as Message;
const user = (text: string): Message => ({ sender: "user", text }) as Message;

/** The daring-narwhal shape: calls → user "continue" wedged in → more calls →
 * all results batched in one late message. */
const CORRUPTED: Message[] = [
  user("[compaction summary]"),
  agentCalls(call("ls", "ls:5"), call("bash", "bash:6")),
  user("continue"),
  agentCalls(call("bash", "bash:2"), call("web_fetch", "web_fetch:3")),
  results(result("ls", "ls:5"), result("bash", "bash:6"), result("bash", "bash:2"), result("web_fetch", "web_fetch:3")),
  user("continue"),
];

describe("repairToolFlow", () => {
  test("re-homes late results to sit directly after their calling message", () => {
    const fixed = repairToolFlow(CORRUPTED);
    const kinds = fixed.map((m) =>
      m.tool_calls?.length ? `calls(${m.tool_calls.map((c) => c.id).join(",")})`
      : m.tool_results?.length ? `results(${m.tool_results.map((r) => r.call_id).join(",")})`
      : `text(${m.text?.slice(0, 12)})`);
    expect(kinds).toEqual([
      "text([compaction )".slice(0, 18),
      "calls(ls:5,bash:6)",
      "results(ls:5,bash:6)",
      "text(continue)",
      "calls(bash:2,web_fetch:3)",
      "results(bash:2,web_fetch:3)",
      "text(continue)",
    ]);
  });

  test("synthesizes interrupted-error results for calls whose results never arrived", () => {
    const dangling: Message[] = [user("go"), agentCalls(call("write", "write:0")), user("continue")];
    const fixed = repairToolFlow(dangling);
    expect(fixed).toHaveLength(4);
    const synth = fixed[2]!;
    expect(synth.tool_results?.[0]?.call_id).toBe("write:0");
    expect(synth.tool_results?.[0]?.result?.status).toBe("error");
    expect(String(synth.tool_results?.[0]?.result?.data)).toContain("interrupted");
  });

  test("drops orphaned results whose call exists nowhere", () => {
    const orphaned: Message[] = [user("go"), results(result("ghost", "ghost:9")), user("next")];
    const fixed = repairToolFlow(orphaned);
    expect(fixed.every((m) => !m.tool_results?.length)).toBe(true);
    expect(fixed.map((m) => m.text)).toEqual(["go", "next"]);
  });

  test("clean histories pass through structurally unchanged and are idempotent", () => {
    const clean: Message[] = [
      user("go"),
      agentCalls(call("read", "read:0")),
      results(result("read", "read:0")),
      { sender: "agent", text: "done" } as Message,
    ];
    expect(toolFlowIsClean(clean)).toBe(true);
    const once = repairToolFlow(clean);
    const twice = repairToolFlow(once);
    expect(twice.map((m) => [m.sender, m.text, (m.tool_results ?? []).map((r) => r.call_id).join(",")]))
      .toEqual(once.map((m) => [m.sender, m.text, (m.tool_results ?? []).map((r) => r.call_id).join(",")]));
    expect(toolFlowIsClean(once)).toBe(true);
  });

  test("the corrupted fixture is detected as unclean", () => {
    expect(toolFlowIsClean(CORRUPTED)).toBe(false);
  });
});
