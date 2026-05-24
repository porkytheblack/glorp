import { describe, test, expect } from "bun:test";
import type { Message, ModelAdapter, ModelPromptRequest, ModelPromptResult } from "glove-core/core";

import { withTrailingToolResultGuard } from "../src/agent/runtime/model-guards.ts";

function userMessage(text: string): Message {
  return { sender: "user", text };
}

function toolResultMessage(toolName = "bash"): Message {
  return {
    sender: "user",
    text: "tool results",
    tool_results: [
      { tool_name: toolName, call_id: "x", result: { status: "success", data: "ok" } },
    ],
  };
}

function agentText(text: string): Message {
  return { sender: "agent", text };
}

function agentToolCall(name = "read"): Message {
  return {
    sender: "agent",
    text: "",
    tool_calls: [{ id: "c1", tool_name: name, input_args: {} }],
  };
}

function makeModel(responses: ModelPromptResult[]): {
  adapter: ModelAdapter;
  calls: ModelPromptRequest[];
} {
  const calls: ModelPromptRequest[] = [];
  let i = 0;
  const adapter: ModelAdapter = {
    name: "fake",
    async prompt(request) {
      calls.push(request);
      const next = responses[Math.min(i, responses.length - 1)]!;
      i++;
      return next;
    },
    setSystemPrompt() {},
  };
  return { adapter, calls };
}

const noopNotify = async () => {};

describe("withTrailingToolResultGuard", () => {
  test("does NOT inject continuation when prompt's last message is a user request", async () => {
    const { adapter, calls } = makeModel([
      { messages: [agentText("hello back")], tokens_in: 1, tokens_out: 1 },
    ]);
    const guarded = withTrailingToolResultGuard(adapter);

    const result = await guarded.prompt(
      { messages: [userMessage("hi")] },
      noopNotify,
    );
    expect(calls).toHaveLength(1);
    expect(result.messages[0]?.text).toBe("hello back");
  });

  test("does NOT inject continuation when model returns visible text after a tool result", async () => {
    const { adapter, calls } = makeModel([
      { messages: [agentText("the file looks fine")], tokens_in: 1, tokens_out: 1 },
    ]);
    const guarded = withTrailingToolResultGuard(adapter);

    await guarded.prompt(
      { messages: [userMessage("check it"), toolResultMessage()] },
      noopNotify,
    );
    expect(calls).toHaveLength(1);
  });

  test("does NOT inject continuation when model returns tool calls (loop will continue)", async () => {
    const { adapter, calls } = makeModel([
      { messages: [agentToolCall("write")], tokens_in: 1, tokens_out: 1 },
    ]);
    const guarded = withTrailingToolResultGuard(adapter);

    await guarded.prompt(
      { messages: [userMessage("do it"), toolResultMessage()] },
      noopNotify,
    );
    expect(calls).toHaveLength(1);
  });

  test("injects continuation when model returns empty after a tool result", async () => {
    const { adapter, calls } = makeModel([
      { messages: [agentText("")], tokens_in: 1, tokens_out: 1 },
      { messages: [agentText("tests passed; ready to commit.")], tokens_in: 1, tokens_out: 1 },
    ]);
    const guarded = withTrailingToolResultGuard(adapter);

    const result = await guarded.prompt(
      { messages: [userMessage("run the tests"), toolResultMessage()] },
      noopNotify,
    );
    expect(calls).toHaveLength(2);
    const injected = calls[1]!.messages.at(-1);
    expect(injected?.sender).toBe("user");
    expect(injected?.text.toLowerCase()).toContain("ending a turn on a tool result is an anti-pattern");
    expect(result.messages[0]?.text).toBe("tests passed; ready to commit.");
  });

  test("ignores trailing skill-injection / compaction messages when picking the latest", async () => {
    const { adapter, calls } = makeModel([
      { messages: [agentText("done")], tokens_in: 1, tokens_out: 1 },
    ]);
    const guarded = withTrailingToolResultGuard(adapter);

    await guarded.prompt(
      {
        messages: [
          userMessage("do it"),
          toolResultMessage(),
          { sender: "user", text: "[skill]", is_skill_injection: true },
          { sender: "user", text: "[compacted]", is_compaction: true },
        ],
      },
      noopNotify,
    );
    // Tool-result is still the "real" latest message; model returned text;
    // no retry needed.
    expect(calls).toHaveLength(1);
  });

  test("aborted signal short-circuits the retry path", async () => {
    const { adapter, calls } = makeModel([
      { messages: [agentText("")], tokens_in: 0, tokens_out: 0 },
    ]);
    const guarded = withTrailingToolResultGuard(adapter);

    const controller = new AbortController();
    controller.abort();
    const result = await guarded.prompt(
      { messages: [userMessage("do it"), toolResultMessage()] },
      noopNotify,
      controller.signal,
    );
    // Only the first call; retry is skipped because the signal is aborted.
    expect(calls).toHaveLength(1);
    expect(result.messages[0]?.text).toBe("");
  });

  test("buffered events on the first attempt are replayed when no retry is needed", async () => {
    const { adapter } = makeModel([
      { messages: [agentText("immediate answer")], tokens_in: 1, tokens_out: 1 },
    ]);
    // Wrap so the first prompt notifies a `text_delta` event.
    const wrapped: ModelAdapter = {
      name: adapter.name,
      setSystemPrompt: adapter.setSystemPrompt,
      async prompt(request, notify, signal) {
        await notify?.("text_delta", { text: "immediate" });
        await notify?.("text_delta", { text: " answer" });
        return adapter.prompt(request, notify, signal);
      },
    };
    const guarded = withTrailingToolResultGuard(wrapped);

    const events: Array<{ et: string; data: unknown }> = [];
    await guarded.prompt(
      { messages: [userMessage("hi"), toolResultMessage()] },
      async (et: any, data: any) => {
        events.push({ et: String(et), data });
      },
    );
    // First attempt's deltas should be replayed exactly once.
    const deltas = events.filter((e) => e.et === "text_delta");
    expect(deltas).toHaveLength(2);
  });
});
