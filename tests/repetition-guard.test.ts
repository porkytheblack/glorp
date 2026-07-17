import { describe, test, expect } from "bun:test";
import type { Message, ModelAdapter, ModelPromptResult } from "glove-core/core";

import {
  callKey,
  trailingIdenticalRun,
  withRepetitionGuard,
} from "../src/agent/runtime/repetition-guard.ts";

const notify: any = async () => {};

function toolCallMsg(command: string, id = "c1"): Message {
  return { sender: "agent", text: "", tool_calls: [{ tool_name: "bash", input_args: { command }, id }] };
}

function toolResultMsg(id = "c1"): Message {
  return {
    sender: "user",
    text: "",
    tool_results: [{ tool_name: "bash", call_id: id, result: { status: "success", data: "out" } }],
  } as Message;
}

function result(...messages: Message[]): ModelPromptResult {
  return { messages, tokens_in: 0, tokens_out: 0 };
}

/** Fake adapter that pops queued results and records every request. */
function fakeModel(queue: ModelPromptResult[]): { model: ModelAdapter; requests: Message[][] } {
  const requests: Message[][] = [];
  return {
    requests,
    model: {
      name: "fake",
      setSystemPrompt: () => {},
      prompt: async (request) => {
        requests.push(request.messages);
        return queue.shift() ?? result();
      },
    },
  };
}

function history(repeats: number, command = "bun test"): Message[] {
  const msgs: Message[] = [{ sender: "user", text: "run the tests" }];
  for (let i = 0; i < repeats; i++) {
    msgs.push(toolCallMsg(command, `c${i}`), toolResultMsg(`c${i}`));
  }
  return msgs;
}

describe("callKey / trailingIdenticalRun", () => {
  test("key is insensitive to object key order", () => {
    expect(callKey({ tool_name: "t", input_args: { a: 1, b: [2, { c: 3 }] } }))
      .toBe(callKey({ tool_name: "t", input_args: { b: [2, { c: 3 }], a: 1 } }));
  });

  test("counts the trailing run of identical calls", () => {
    const run = trailingIdenticalRun(history(3));
    expect(run?.count).toBe(3);
    expect(run?.toolName).toBe("bash");
  });

  test("a different call ends the run", () => {
    const msgs = [...history(2), toolCallMsg("ls", "x"), toolResultMsg("x")];
    expect(trailingIdenticalRun(msgs)?.count).toBe(1);
  });

  test("a real user message resets the run", () => {
    const msgs = [...history(2), { sender: "user", text: "try that again please" } as Message];
    expect(trailingIdenticalRun(msgs)).toBeNull();
  });

  test("internal nudges do not reset the run", () => {
    const msgs = [...history(2), { sender: "user", text: "[internal]", is_skill_injection: true } as Message];
    expect(trailingIdenticalRun(msgs)?.count).toBe(2);
  });
});

describe("withRepetitionGuard", () => {
  test("does not intervene below the trigger run", async () => {
    const { model, requests } = fakeModel([result(toolCallMsg("bun test"))]);
    await withRepetitionGuard(model).prompt({ messages: history(1) } as any, notify);
    expect(requests.length).toBe(1);
  });

  test("passes through when the model moves on to a different call", async () => {
    const { model, requests } = fakeModel([result(toolCallMsg("ls", "n1"))]);
    const out = await withRepetitionGuard(model).prompt({ messages: history(2) } as any, notify);
    expect(requests.length).toBe(1);
    expect(out.messages[0]?.tool_calls?.[0]?.input_args).toEqual({ command: "ls" });
  });

  test("re-prompts with a nudge when the model repeats a run of 2", async () => {
    const { model, requests } = fakeModel([
      result(toolCallMsg("bun test", "n1")),
      result({ sender: "agent", text: "stuck: tests fail the same way" } as Message),
    ]);
    const out = await withRepetitionGuard(model).prompt({ messages: history(2) } as any, notify);
    expect(requests.length).toBe(2);
    const nudge = requests[1]!.at(-1)!;
    expect(nudge.text).toContain("identical arguments");
    expect(nudge.is_skill_injection).toBe(true);
    // The repeated attempt's tool call must not survive into the retry request.
    expect(requests[1]!.some((m) => m.tool_calls?.length)).toBe(true); // history calls remain
    expect(requests[1]!.slice(history(2).length).some((m) => m.tool_calls?.length)).toBe(false);
    expect(out.messages[0]?.text).toContain("stuck");
  });

  test("gives up after one nudge if the model insists", async () => {
    const insisting = result(toolCallMsg("bun test", "n2"));
    const { model, requests } = fakeModel([result(toolCallMsg("bun test", "n1")), insisting]);
    const out = await withRepetitionGuard(model).prompt({ messages: history(2) } as any, notify);
    expect(requests.length).toBe(2);
    expect(out).toBe(insisting);
  });
});
