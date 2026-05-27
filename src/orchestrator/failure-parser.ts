/**
 * Parse test/typecheck/lint failure output into structured failure records.
 * Helps the evaluator and generator pinpoint exact issues instead of
 * reading through raw command output.
 */

export interface ParsedFailure {
  /** File path extracted from the output (relative or absolute). */
  file?: string;
  /** Line number (1-based) if available. */
  line?: number;
  /** Column number (1-based) if available. */
  column?: number;
  /** Category: "test", "type", "lint", or "build". */
  kind: "test" | "type" | "lint" | "build";
  /** Short description of the failure. */
  message: string;
}

/**
 * Extract structured failures from raw command output.
 * Returns an empty array when no parseable failures are found.
 */
export function parseFailures(output: string, kind?: ParsedFailure["kind"]): ParsedFailure[] {
  const failures: ParsedFailure[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // TypeScript-style errors: src/file.ts(10,5): error TS2345: ...
    const tsMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/);
    if (tsMatch) {
      failures.push({
        file: tsMatch[1], line: Number(tsMatch[2]), column: Number(tsMatch[3]),
        kind: kind ?? "type", message: `${tsMatch[4]}: ${tsMatch[5]}`,
      });
      continue;
    }
    // TSC alternate format: src/file.ts:10:5 - error TS2345: ...
    const tsAlt = line.match(/^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)/);
    if (tsAlt) {
      failures.push({
        file: tsAlt[1], line: Number(tsAlt[2]), column: Number(tsAlt[3]),
        kind: kind ?? "type", message: `${tsAlt[4]}: ${tsAlt[5]}`,
      });
      continue;
    }
    // ESLint/Biome: src/file.ts:10:5: error: ...  OR  src/file.ts:10:5 Error: ...
    const lintMatch = line.match(/^(.+?):(\d+):(\d+)[:\s]+(?:error|Error|warning|Warning)[:\s]+(.+)/);
    if (lintMatch && !lintMatch[1].includes(" ")) {
      failures.push({
        file: lintMatch[1], line: Number(lintMatch[2]), column: Number(lintMatch[3]),
        kind: kind ?? "lint", message: lintMatch[4].trim(),
      });
      continue;
    }
    // Bun/Jest test failure: ✗ test name  OR  ✕ test name  OR  FAIL src/file.test.ts
    const bunFail = line.match(/^\s*(?:✗|✕|×|FAIL)\s+(.+)/);
    if (bunFail) {
      const testFile = extractTestFile(lines, i);
      failures.push({
        file: testFile ?? undefined, kind: kind ?? "test",
        message: bunFail[1].trim(),
      });
      continue;
    }
    // Generic "error:" pattern with file:line
    const genericMatch = line.match(/^(.+?):(\d+):\s*(?:error|Error):\s*(.+)/);
    if (genericMatch && !genericMatch[1].includes(" ") && genericMatch[1].includes("/")) {
      failures.push({
        file: genericMatch[1], line: Number(genericMatch[2]),
        kind: kind ?? "build", message: genericMatch[3].trim(),
      });
    }
  }
  return dedup(failures);
}

/** Format failures into a focused summary for agent consumption. */
export function formatFailureSummary(failures: ParsedFailure[]): string {
  if (failures.length === 0) return "";
  const lines: string[] = [`### Parsed Failures (${failures.length})`];
  const byKind = groupBy(failures, (f) => f.kind);
  for (const [kind, group] of Object.entries(byKind)) {
    lines.push(`\n**${kind}** (${group.length}):`);
    for (const f of group.slice(0, 15)) {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "unknown";
      lines.push(`- \`${loc}\`: ${f.message}`);
    }
    if (group.length > 15) lines.push(`  … and ${group.length - 15} more`);
  }
  return lines.join("\n");
}

function extractTestFile(lines: string[], fromIndex: number): string | null {
  for (let i = fromIndex - 1; i >= Math.max(0, fromIndex - 10); i--) {
    const m = lines[i].match(/^\s*(?:FAIL|RUN|RUNS?)\s+(.+\.(?:test|spec)\.\w+)/);
    if (m) return m[1].trim();
    const fileHeader = lines[i].match(/^(.+\.(?:test|spec)\.\w+):/);
    if (fileHeader) return fileHeader[1].trim();
  }
  return null;
}

function dedup(failures: ParsedFailure[]): ParsedFailure[] {
  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.file}:${f.line}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (result[k] ??= []).push(item);
  }
  return result;
}
