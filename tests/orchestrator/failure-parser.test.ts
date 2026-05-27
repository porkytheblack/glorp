import { describe, test, expect } from "bun:test";
import { parseFailures, formatFailureSummary } from "../../src/orchestrator/failure-parser.ts";

describe("parseFailures", () => {
  test("parses TypeScript errors (parenthesized format)", () => {
    const output = `src/index.ts(10,5): error TS2345: Argument of type 'string' is not assignable.`;
    const failures = parseFailures(output, "type");
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe("src/index.ts");
    expect(failures[0].line).toBe(10);
    expect(failures[0].column).toBe(5);
    expect(failures[0].kind).toBe("type");
    expect(failures[0].message).toContain("TS2345");
  });

  test("parses TypeScript errors (colon format)", () => {
    const output = `src/app.ts:42:8 - error TS2339: Property 'foo' does not exist.`;
    const failures = parseFailures(output);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe("src/app.ts");
    expect(failures[0].line).toBe(42);
    expect(failures[0].column).toBe(8);
  });

  test("parses ESLint-style errors", () => {
    const output = `src/utils.ts:15:3: error: Unexpected var, use let or const`;
    const failures = parseFailures(output);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe("src/utils.ts");
    expect(failures[0].line).toBe(15);
    expect(failures[0].kind).toBe("lint");
  });

  test("parses Bun/Jest test failures", () => {
    const output = [
      "tests/app.test.ts:",
      "  ✗ should handle edge case [2.34ms]",
      "  ✗ should validate input [0.52ms]",
    ].join("\n");
    const failures = parseFailures(output, "test");
    expect(failures).toHaveLength(2);
    expect(failures[0].kind).toBe("test");
    expect(failures[0].message).toContain("handle edge case");
  });

  test("deduplicates identical failures", () => {
    const output = [
      "src/a.ts:1:1 - error TS1234: Duplicate error",
      "src/a.ts:1:1 - error TS1234: Duplicate error",
    ].join("\n");
    const failures = parseFailures(output);
    expect(failures).toHaveLength(1);
  });

  test("returns empty for clean output", () => {
    const output = "All tests passed.\n42 pass, 0 fail";
    expect(parseFailures(output)).toEqual([]);
  });

  test("parses generic file:line errors", () => {
    const output = `src/lib/parser.ts:88: Error: Unexpected token`;
    const failures = parseFailures(output);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe("src/lib/parser.ts");
    expect(failures[0].line).toBe(88);
  });

  test("handles mixed error types", () => {
    const output = [
      `src/types.ts(5,1): error TS2304: Cannot find name 'Foo'.`,
      `src/app.ts:10:5: error: no-unused-vars`,
      `  ✗ should work`,
    ].join("\n");
    const failures = parseFailures(output);
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatFailureSummary", () => {
  test("returns empty for no failures", () => {
    expect(formatFailureSummary([])).toBe("");
  });

  test("groups by kind", () => {
    const failures = [
      { file: "a.ts", line: 1, kind: "type" as const, message: "TS2345" },
      { file: "b.ts", line: 2, kind: "type" as const, message: "TS2339" },
      { file: "c.ts", line: 3, kind: "test" as const, message: "assertion" },
    ];
    const summary = formatFailureSummary(failures);
    expect(summary).toContain("**type** (2)");
    expect(summary).toContain("**test** (1)");
    expect(summary).toContain("Parsed Failures (3)");
  });

  test("includes file:line locations", () => {
    const failures = [
      { file: "src/index.ts", line: 42, kind: "type" as const, message: "bad" },
    ];
    const summary = formatFailureSummary(failures);
    expect(summary).toContain("`src/index.ts:42`");
  });

  test("truncates at 15 per kind", () => {
    const failures = Array.from({ length: 20 }, (_, i) => ({
      file: `f${i}.ts`, line: i, kind: "test" as const, message: `fail ${i}`,
    }));
    const summary = formatFailureSummary(failures);
    expect(summary).toContain("and 5 more");
  });
});
