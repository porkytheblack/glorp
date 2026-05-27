import { describe, test, expect } from "bun:test";
import { parseBuildCommand } from "../../src/agent/runtime/build-flow.ts";
import {
  IMPLEMENTATION_COMPLETE,
  VERIFICATION_PASSED,
} from "../../src/orchestrator/checkpoints.ts";
import { formatCriteriaBlock, parseVerdict } from "../../src/orchestrator/checkpoints.ts";
import { defaultVerificationCommands } from "../../src/orchestrator/verification.ts";
import type { WorkspaceContext } from "../../src/orchestrator/workspace-context.ts";

describe("parseBuildCommand", () => {
  test("extracts prompt from /build command", () => {
    expect(parseBuildCommand("/build create a REST API")).toBe("create a REST API");
  });

  test("trims whitespace", () => {
    expect(parseBuildCommand("/build   add auth  ")).toBe("add auth");
  });

  test("handles multiline", () => {
    expect(parseBuildCommand("/build line one\nline two")).toBe("line one\nline two");
  });

  test("returns null for non-build messages", () => {
    expect(parseBuildCommand("hello world")).toBeNull();
  });

  test("returns null for empty /build", () => {
    expect(parseBuildCommand("/build")).toBeNull();
  });
});

describe("IMPLEMENTATION_COMPLETE checkpoint", () => {
  test("has five criteria", () => {
    expect(IMPLEMENTATION_COMPLETE.criteria).toHaveLength(5);
  });

  test("format produces readable block", () => {
    const block = formatCriteriaBlock(IMPLEMENTATION_COMPLETE);
    expect(block).toContain("implementation_complete");
    expect(block).toContain("type errors");
    expect(block).toContain("placeholder");
  });

  test("evaluator can approve implementation", () => {
    const response = `
      I checked all five criteria. The code compiles, no TODOs remain.
      { "action": "proceed", "note": "All criteria met — code is structurally complete." }
    `;
    const verdict = parseVerdict(response);
    expect(verdict.action).toBe("proceed");
  });

  test("evaluator can request retry on type errors", () => {
    const response = `
      Criterion 2 fails: tsc reports 3 errors in parser.ts.
      { "action": "retry", "feedback": "Type errors in parser.ts:42, parser.ts:67, parser.ts:91. All are missing return types." }
    `;
    const verdict = parseVerdict(response);
    expect(verdict.action).toBe("retry");
    expect((verdict as any).feedback).toContain("parser.ts");
  });
});

describe("VERIFICATION_PASSED checkpoint", () => {
  test("has four criteria", () => {
    expect(VERIFICATION_PASSED.criteria).toHaveLength(4);
  });

  test("format includes typecheck and test criteria", () => {
    const block = formatCriteriaBlock(VERIFICATION_PASSED);
    expect(block).toContain("Typecheck");
    expect(block).toContain("tests still pass");
    expect(block).toContain("New tests");
  });
});

describe("build pipeline verification integration", () => {
  test("defaultVerificationCommands from TypeScript project context", () => {
    const ctx: WorkspaceContext = {
      packageManager: "bun",
      language: "typescript",
      framework: null,
      buildCommand: "build",
      testCommand: "bun test",
      lintCommand: "biome check .",
      typecheckCommand: "tsc --noEmit",
      srcDirs: ["src"],
      testDirs: ["tests"],
      promptBlock: "",
    };
    const cmds = defaultVerificationCommands(ctx);
    expect(cmds).toHaveLength(3);
    expect(cmds[0].name).toBe("typecheck");
    expect(cmds[0].blocking).toBe(true);
    expect(cmds[1].name).toBe("test");
    expect(cmds[1].blocking).toBe(false);
    expect(cmds[2].name).toBe("lint");
    expect(cmds[2].blocking).toBe(false);
  });

  test("no commands for empty context", () => {
    const ctx: WorkspaceContext = {
      packageManager: null, language: null, framework: null,
      buildCommand: null, testCommand: null, lintCommand: null,
      typecheckCommand: null, srcDirs: [], testDirs: [], promptBlock: "",
    };
    expect(defaultVerificationCommands(ctx)).toHaveLength(0);
  });

  test("typecheck-only project", () => {
    const ctx: WorkspaceContext = {
      packageManager: "npm", language: "typescript", framework: null,
      buildCommand: null, testCommand: null, lintCommand: null,
      typecheckCommand: "tsc --noEmit", srcDirs: [], testDirs: [], promptBlock: "",
    };
    const cmds = defaultVerificationCommands(ctx);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name).toBe("typecheck");
  });
});
