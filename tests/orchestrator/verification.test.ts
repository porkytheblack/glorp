import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runVerification, defaultVerificationCommands, type VerificationCommand } from "../../src/orchestrator/verification.ts";
import type { WorkspaceContext } from "../../src/orchestrator/workspace-context.ts";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), "verify-test-")); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

function cmd(name: string, command: string, blocking = false): VerificationCommand {
  return { name, command, blocking };
}
function ctx(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    packageManager: null, language: null, framework: null, buildCommand: null,
    testCommand: null, lintCommand: null, typecheckCommand: null,
    srcDirs: [], testDirs: [], promptBlock: "", ...overrides,
  };
}

describe("runVerification", () => {
  test("passing command captures output", async () => {
    const report = await runVerification(tmp, [cmd("echo", "echo hello")]);
    expect(report.allPassed).toBe(true);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].passed).toBe(true);
    expect(report.results[0].exitCode).toBe(0);
    expect(report.results[0].output).toContain("hello");
    expect(report.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("failing command records exit code", async () => {
    const report = await runVerification(tmp, [cmd("fail", "exit 42")]);
    expect(report.allPassed).toBe(false);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].exitCode).toBe(42);
  });

  test("captures stderr", async () => {
    const report = await runVerification(tmp, [cmd("err", "echo bad >&2; exit 1")]);
    expect(report.results[0].output).toContain("bad");
  });

  test("blocking failure skips subsequent commands", async () => {
    const report = await runVerification(tmp, [
      cmd("blocker", "exit 1", true), cmd("after", "echo should-not-run"),
    ]);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[1].passed).toBe(false);
    expect(report.results[1].output).toContain("Skipped");
    expect(report.results[1].exitCode).toBe(-1);
    expect(report.results[1].durationMs).toBe(0);
  });

  test("non-blocking failure does NOT skip subsequent", async () => {
    const report = await runVerification(tmp, [
      cmd("soft-fail", "exit 1", false), cmd("next", "echo ran"),
    ]);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[1].passed).toBe(true);
    expect(report.results[1].output).toContain("ran");
  });

  test("multiple blocking skips all after first failure", async () => {
    const report = await runVerification(tmp, [
      cmd("ok", "echo fine"), cmd("blocker", "exit 2", true),
      cmd("a", "echo nope"), cmd("b", "echo nope"),
    ]);
    expect(report.results).toHaveLength(4);
    expect(report.results[0].passed).toBe(true);
    expect(report.results[1].passed).toBe(false);
    expect(report.results[2].output).toContain("Skipped");
    expect(report.results[3].output).toContain("Skipped");
  });

  test("timeout kills long-running command", async () => {
    const report = await runVerification(tmp, [cmd("slow", "sleep 30")], { timeoutMs: 200 });
    expect(report.allPassed).toBe(false);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].output).toContain("Timed out");
  }, 10_000);

  test("signal cancellation aborts pending commands", async () => {
    const ac = new AbortController();
    ac.abort();
    const report = await runVerification(
      tmp, [cmd("a", "echo hi"), cmd("b", "echo bye")], { signal: ac.signal },
    );
    expect(report.allPassed).toBe(false);
    for (const r of report.results) {
      expect(r.passed).toBe(false);
      expect(r.output).toContain("Cancelled");
    }
  });

  test("signal mid-execution aborts running command", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const report = await runVerification(tmp, [cmd("slow", "sleep 30")], { signal: ac.signal });
    expect(report.allPassed).toBe(false);
    expect(report.results[0].passed).toBe(false);
  }, 10_000);

  test("command that crashes still produces result", async () => {
    const report = await runVerification(tmp, [
      cmd("missing", "/usr/bin/nonexistent-binary-xyz 2>/dev/null; exit $?"),
    ]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].passed).toBe(false);
  });

  test("empty command list returns allPassed true", async () => {
    const report = await runVerification(tmp, []);
    expect(report.allPassed).toBe(true);
    expect(report.results).toHaveLength(0);
    expect(report.summary).toBe("");
  });
});

describe("summary format", () => {
  test("all passing", async () => {
    const report = await runVerification(tmp, [cmd("typecheck", "true"), cmd("lint", "true")]);
    expect(report.summary).toBe("typecheck ✓, lint ✓");
  });

  test("mixed results", async () => {
    const report = await runVerification(tmp, [
      cmd("typecheck", "true"), cmd("test", "exit 1"), cmd("lint", "true"),
    ]);
    expect(report.summary).toBe("typecheck ✓, test ✗ (exit 1), lint ✓");
  });
});

describe("detailBlock format", () => {
  test("contains header and per-command sections", async () => {
    const report = await runVerification(tmp, [
      cmd("typecheck", "true"), cmd("test", "echo 'fail output'; exit 1"),
    ]);
    expect(report.detailBlock).toContain("## Verification Results");
    expect(report.detailBlock).toContain("### typecheck (`true`) — PASS ✓");
    expect(report.detailBlock).toContain("### test (`echo 'fail output'; exit 1`) — FAIL ✗");
    expect(report.detailBlock).toContain("Exit code: 1");
    expect(report.detailBlock).toContain("fail output");
  });

  test("passing with no output shows (no output)", async () => {
    const report = await runVerification(tmp, [cmd("check", "true")]);
    expect(report.detailBlock).toContain("(no output)");
  });
});

describe("defaultVerificationCommands", () => {
  test("empty context yields no commands", () => {
    expect(defaultVerificationCommands(ctx())).toHaveLength(0);
  });

  test("typecheck only", () => {
    const cmds = defaultVerificationCommands(ctx({ typecheckCommand: "tsc --noEmit" }));
    expect(cmds).toEqual([{ name: "typecheck", command: "tsc --noEmit", blocking: true }]);
  });

  test("all three commands in correct order and blocking flags", () => {
    const cmds = defaultVerificationCommands(ctx({
      typecheckCommand: "tsc --noEmit", testCommand: "bun test", lintCommand: "biome check .",
    }));
    expect(cmds).toHaveLength(3);
    expect(cmds[0]).toEqual({ name: "typecheck", command: "tsc --noEmit", blocking: true });
    expect(cmds[1]).toEqual({ name: "test", command: "bun test", blocking: false });
    expect(cmds[2]).toEqual({ name: "lint", command: "biome check .", blocking: false });
  });

  test("test and lint only (no typecheck)", () => {
    const cmds = defaultVerificationCommands(ctx({ testCommand: "pytest", lintCommand: "ruff check ." }));
    expect(cmds).toHaveLength(2);
    expect(cmds[0].name).toBe("test");
    expect(cmds[1].name).toBe("lint");
  });
});
