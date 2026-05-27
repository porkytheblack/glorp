import { describe, test, expect } from "bun:test";
import { ROLE_DEFS, roleDef, rolePrompt } from "../../src/orchestrator/role-registry.ts";

const KNOWN_ROLES = ["generator", "evaluator", "researcher", "builder", "planner", "reviewer"];

describe("ROLE_DEFS", () => {
  test("all six roles defined", () => {
    for (const role of KNOWN_ROLES) {
      expect(ROLE_DEFS[role]).toBeDefined();
    }
  });

  test.each(KNOWN_ROLES)("%s has required fields", (role) => {
    const def = ROLE_DEFS[role];
    expect(def.name).toBeTruthy();
    expect(def.description).toBeTruthy();
    expect(def.promptKey).toBeTruthy();
    expect(def.tools.length).toBeGreaterThan(0);
    expect(def.capabilities.length).toBeGreaterThan(0);
    expect(def.compaction).toBeTruthy();
    expect(def.maxTurns).toBeGreaterThan(0);
  });

  test("generator has write tools", () => {
    const tools = ROLE_DEFS.generator.tools;
    expect(tools).toContain("write");
    expect(tools).toContain("edit");
    expect(tools).toContain("bash");
  });

  test("evaluator has read + bash for verification", () => {
    const tools = ROLE_DEFS.evaluator.tools;
    expect(tools).toContain("read");
    expect(tools).toContain("bash");
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
  });

  test("researcher has web_fetch", () => {
    expect(ROLE_DEFS.researcher.tools).toContain("web_fetch");
  });

  test("builder has write tools but no interactive tools", () => {
    const tools = ROLE_DEFS.builder.tools;
    expect(tools).toContain("write");
    expect(tools).not.toContain("ask_confirm");
  });
});

describe("roleDef", () => {
  test("returns def for known role", () => {
    const def = roleDef("generator");
    expect(def.name).toBe("Generator");
    expect(def.promptKey).toBe("agents/generator.md");
  });

  test("throws for unknown role", () => {
    expect(() => roleDef("nonexistent")).toThrow("Unknown role");
  });
});

describe("rolePrompt", () => {
  test("returns non-empty string for each role", () => {
    for (const role of KNOWN_ROLES) {
      const prompt = rolePrompt(role);
      expect(prompt.length).toBeGreaterThan(10);
    }
  });

  test("throws for unknown role", () => {
    expect(() => rolePrompt("nonexistent")).toThrow("Unknown role");
  });
});
