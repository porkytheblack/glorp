import { describe, test, expect } from "bun:test";
import type { Message, ModelAdapter, ModelPromptResult } from "glove-core/core";
import { VerificationTracker } from "../../src/agent/runtime/verification-tracker.ts";
import { withVerificationEnforcement } from "../../src/agent/runtime/verification-guard.ts";

function mockModel(response: Partial<Message>): ModelAdapter {
  const calls: Message[][] = [];
  return {
    name: "mock",
    setSystemPrompt() {},
    async prompt(request): Promise<ModelPromptResult> {
      calls.push([...request.messages]);
      return {
        messages: [{
          sender: "agent",
          text: "",
          ...response,
        }],
      };
    },
    _calls: calls,
  } as any;
}

function agentMsg(text: string, toolCalls?: unknown[]): Message {
  return { sender: "agent", text, ...(toolCalls ? { tool_calls: toolCalls } : {}) } as Message;
}

describe("withVerificationEnforcement", () => {
  test("passes through when no pending mutations", async () => {
    const tracker = new VerificationTracker();
    const inner = mockModel({ text: "All done! Implementation complete." });
    const guarded = withVerificationEnforcement(inner, tracker);
    const result = await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    expect(result.messages[0].text).toContain("All done");
    expect((inner as any)._calls).toHaveLength(1);
  });

  test("passes through when model makes tool calls", async () => {
    const tracker = new VerificationTracker();
    tracker.recordMutation("src/app.ts");
    const inner = mockModel({ text: "", tool_calls: [{ id: "t1", name: "bash" }] });
    const guarded = withVerificationEnforcement(inner, tracker);
    const result = await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    // Tool call means the agent is still working — don't intercept
    expect((inner as any)._calls).toHaveLength(1);
  });

  test("intercepts completion claim with pending mutations", async () => {
    const tracker = new VerificationTracker();
    tracker.recordMutation("src/index.ts");
    tracker.recordMutation("src/utils.ts");
    const inner = mockModel({ text: "I've completed the implementation." });
    const guarded = withVerificationEnforcement(inner, tracker);
    await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    // Should have been called twice: original + enforcement retry
    expect((inner as any)._calls).toHaveLength(2);
    const retryMessages = (inner as any)._calls[1] as Message[];
    const lastMsg = retryMessages.at(-1);
    expect(lastMsg?.text).toContain("verification enforcement");
  });

  test("intercepts completion claim with failed verifications", async () => {
    const tracker = new VerificationTracker();
    tracker.recordFailedVerification("bun test", "exit code 1", "bun test");
    const inner = mockModel({ text: "All tests pass and the work is done." });
    const guarded = withVerificationEnforcement(inner, tracker);
    await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    expect((inner as any)._calls).toHaveLength(2);
  });

  test("does not intercept non-completion responses", async () => {
    const tracker = new VerificationTracker();
    tracker.recordMutation("src/app.ts");
    const inner = mockModel({ text: "Let me analyze the code structure." });
    const guarded = withVerificationEnforcement(inner, tracker);
    await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    // Non-completion text should not trigger enforcement
    expect((inner as any)._calls).toHaveLength(1);
  });

  test("clears after successful verification", async () => {
    const tracker = new VerificationTracker();
    tracker.recordMutation("src/app.ts");
    tracker.recordVerification("bun test");
    const inner = mockModel({ text: "Implementation is complete." });
    const guarded = withVerificationEnforcement(inner, tracker);
    await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    // Verification passed + no pending → should not intercept
    expect((inner as any)._calls).toHaveLength(1);
  });

  test("detects various completion phrases", async () => {
    const tracker = new VerificationTracker();
    const phrases = [
      "The changes are complete.",
      "I've finished implementing the feature.",
      "Everything is done and ready for review.",
      "Successfully completed all the requested changes.",
      "The implementation should now be working.",
    ];
    for (const phrase of phrases) {
      tracker.recordMutation("src/file.ts");
      const inner = mockModel({ text: phrase });
      const guarded = withVerificationEnforcement(inner, tracker);
      await guarded.prompt(
        { messages: [], system: "" } as any, async () => {}, undefined,
      );
      expect((inner as any)._calls).toHaveLength(2);
    }
  });

  test("uses document guidance when pending work is all documents", async () => {
    const tracker = new VerificationTracker();
    tracker.recordMutation("uploads/report.docx");
    const inner = mockModel({ text: "The document is complete." });
    const guarded = withVerificationEnforcement(inner, tracker);
    await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    expect((inner as any)._calls).toHaveLength(2);
    const retryMessages = (inner as any)._calls[1] as Message[];
    const lastMsg = retryMessages.at(-1);
    expect(lastMsg?.text).toContain("document/artifact deliverable");
    expect(lastMsg?.text).toContain("reviewer");
    expect(lastMsg?.text).not.toContain("Run the test suite");
  });

  test("uses code guidance when any pending file is source", async () => {
    const tracker = new VerificationTracker();
    tracker.recordMutation("uploads/report.docx");
    tracker.recordMutation("src/app.ts");
    const inner = mockModel({ text: "The work is complete." });
    const guarded = withVerificationEnforcement(inner, tracker);
    await guarded.prompt(
      { messages: [], system: "" } as any, async () => {}, undefined,
    );
    expect((inner as any)._calls).toHaveLength(2);
    const lastMsg = ((inner as any)._calls[1] as Message[]).at(-1);
    expect(lastMsg?.text).toContain("Run the test suite");
  });

  test("preserves model name", () => {
    const tracker = new VerificationTracker();
    const inner = mockModel({});
    const guarded = withVerificationEnforcement(inner, tracker);
    expect(guarded.name).toBe("mock");
  });
});
