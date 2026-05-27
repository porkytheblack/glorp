import { describe, test, expect } from "bun:test";
import { blueprintToInput, AgentInput } from "../../src/orchestrator/agent-factory.ts";
import type { AgentBlueprint } from "../../src/orchestrator/types.ts";

const baseBp: AgentBlueprint = {
  id: "test_1" as any,
  label: "Test Agent",
  role: "builder",
  tools: ["read", "edit"],
  systemPrompt: "You are a builder.",
};

describe("AgentInput schema", () => {
  test("accepts minimal input", () => {
    const result = AgentInput.safeParse({
      prompt: "build it",
      workspace: "/tmp",
      dataDir: "/tmp/data",
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing prompt", () => {
    const result = AgentInput.safeParse({
      workspace: "/tmp",
      dataDir: "/tmp/data",
    });
    expect(result.success).toBe(false);
  });
});

describe("blueprintToInput", () => {
  const cfg = { workspace: "/work", dataDir: "/data" };

  test("basic serialization without custom systemPrompt", () => {
    const input = blueprintToInput(baseBp, "do the thing", cfg);
    expect(input.prompt).toBe("do the thing");
    expect(input.workspace).toBe("/work");
    expect(input.dataDir).toBe("/data");
  });

  test("forwards customContext as prompt prefix", () => {
    const bp: AgentBlueprint = {
      ...baseBp,
      customContext: "You are a security auditor. Focus on vulnerabilities.",
    };
    const input = blueprintToInput(bp, "review the auth module", cfg);
    expect(input.prompt).toContain("security auditor");
    expect(input.prompt).toContain("review the auth module");
  });

  test("customContext is prepended, not appended", () => {
    const bp: AgentBlueprint = { ...baseBp, customContext: "Custom persona." };
    const input = blueprintToInput(bp, "task here", cfg);
    const contextIdx = input.prompt.indexOf("Custom persona");
    const taskIdx = input.prompt.indexOf("task here");
    expect(contextIdx).toBeLessThan(taskIdx);
  });

  test("no customContext means prompt is untouched", () => {
    const input = blueprintToInput(baseBp, "just do it", cfg);
    expect(input.prompt).toBe("just do it");
  });
});
