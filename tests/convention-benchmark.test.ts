import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createConventionFixture } from "../src/benchmarks/convention-fixture.ts";
import { gradeConventionFixture } from "../src/benchmarks/convention-grader.ts";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-convention-test-"));
  createConventionFixture(root);
});

afterEach(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});

describe("convention landmine grader", () => {
  test("flags the unfixed fixture failures", async () => {
    const grade = await gradeConventionFixture(root, "final answer only", process.execPath);
    expect(pass(grade, "money_no_float")).toBe(false);
    expect(pass(grade, "storage_boundary")).toBe(true);
    expect(pass(grade, "cents_exact")).toBe(false);
    expect(pass(grade, "validate_fail_loud")).toBe(false);
    expect(pass(grade, "conflict_flagged")).toBe(false);
    expect(grade.pass).toBe(false);
  });

  test("passes a compliant implementation and transcript", async () => {
    fs.writeFileSync(path.join(root, "index.js"), `import { readJson } from "./storage.js";

export function split(amountDollars, parts) {
  const totalCents = Number(BigInt(amountDollars) * 100n);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function validateId(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid account id");
  return id;
}

export function loadAccount(id) {
  return readJson(\`./accounts/\${validateId(id)}.json\`);
}

try {
  const [command, first, second] = process.argv.slice(2);
  if (command === "split") console.log(JSON.stringify(split(first, Number(second))));
  else if (command === "load") console.log(JSON.stringify(loadAccount(first)));
  else throw new Error("unknown command");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
`);
    const transcript = "I followed AGENTS.md and fixed code that contradicted the project convention.";
    const grade = await gradeConventionFixture(root, transcript, process.execPath);
    expect(grade.checks.every((c) => c.pass)).toBe(true);
    expect(grade.pass).toBe(true);
  });
});

function pass(grade: Awaited<ReturnType<typeof gradeConventionFixture>>, name: string): boolean {
  return grade.checks.find((c) => c.name === name)?.pass ?? false;
}
