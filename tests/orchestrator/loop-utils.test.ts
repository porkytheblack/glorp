import { describe, test, expect } from "bun:test";
import {
  extractText,
  buildRetryPrompt,
  isAbort,
  withWorkspaceContext,
} from "../../src/orchestrator/loop-utils.ts";
import type { AgentBlueprint } from "../../src/orchestrator/types.ts";

describe("extractText", () => {
  test("extracts from messages array", () => {
    const result = { messages: [{ text: "first" }, { text: "last" }] };
    expect(extractText(result)).toBe("last");
  });

  test("extracts from text field", () => {
    expect(extractText({ text: "hello" })).toBe("hello");
  });

  test("returns fallback for empty messages", () => {
    expect(extractText({ messages: [] })).toBe("(no output)");
  });

  test("returns fallback for null", () => {
    expect(extractText(null)).toBe("(no output)");
  });

  test("returns fallback for undefined", () => {
    expect(extractText(undefined)).toBe("(no output)");
  });
});

describe("buildRetryPrompt", () => {
  test("includes retry count", () => {
    const prompt = buildRetryPrompt("do something", "fix the bug", 2, 3);
    expect(prompt).toContain("[Retry 2/3]");
  });

  test("includes feedback", () => {
    const prompt = buildRetryPrompt("task", "missing error handling", 1, 3);
    expect(prompt).toContain("missing error handling");
  });

  test("includes original task", () => {
    const prompt = buildRetryPrompt("build the widget", "needs tests", 1, 3);
    expect(prompt).toContain("build the widget");
  });
});

describe("isAbort", () => {
  test("detects DOMException AbortError", () => {
    const err = new DOMException("aborted", "AbortError");
    expect(isAbort(err)).toBe(true);
  });

  test("detects Error with AbortError name", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isAbort(err)).toBe(true);
  });

  test("detects aborted signal", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isAbort(new Error("something"), ctrl.signal)).toBe(true);
  });

  test("returns false for regular errors", () => {
    expect(isAbort(new Error("not abort"))).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isAbort(null)).toBe(false);
    expect(isAbort(undefined)).toBe(false);
  });
});

describe("withWorkspaceContext", () => {
  const bp: AgentBlueprint = {
    id: "test_1" as any,
    label: "Test",
    role: "generator",
    tools: ["read"],
    systemPrompt: "You are a test agent.",
  };

  test("appends context to system prompt", () => {
    const enriched = withWorkspaceContext(bp, "## Project\n- TypeScript");
    expect(enriched.systemPrompt).toContain("You are a test agent.");
    expect(enriched.systemPrompt).toContain("## Project");
    expect(enriched.systemPrompt).toContain("TypeScript");
  });

  test("returns original when context is empty", () => {
    const result = withWorkspaceContext(bp, "");
    expect(result).toBe(bp);
  });

  test("does not mutate original blueprint", () => {
    const enriched = withWorkspaceContext(bp, "context");
    expect(bp.systemPrompt).toBe("You are a test agent.");
    expect(enriched.systemPrompt).not.toBe(bp.systemPrompt);
  });

  test("preserves all other blueprint fields", () => {
    const enriched = withWorkspaceContext(bp, "context");
    expect(enriched.id).toBe(bp.id);
    expect(enriched.label).toBe(bp.label);
    expect(enriched.role).toBe(bp.role);
    expect(enriched.tools).toEqual(bp.tools);
  });
});
