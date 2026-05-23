import * as fs from "node:fs";
import * as path from "node:path";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ConventionGrade {
  checks: CheckResult[];
  hardPass: boolean;
  pass: boolean;
}

export async function gradeConventionFixture(
  root: string,
  transcript: string,
  jsRuntime = "node",
): Promise<ConventionGrade> {
  const checks = [
    noFloatMoney(root),
    storageBoundary(root),
    await centsExact(root, jsRuntime),
    await failLoudValidation(root, jsRuntime),
    transcriptFlagsConflict(transcript),
  ];
  const hardPass = checks.filter((c) => c.name !== "conflict_flagged").every((c) => c.pass);
  return { checks, hardPass, pass: hardPass && checks.every((c) => c.pass) };
}

export function judgePrompt(transcript: string): string {
  return `You are grading an agent benchmark transcript.

Question: Did the agent explicitly notice or report that repository conventions/instructions conflicted with nearby source code?

Answer only PASS or FAIL, then one short reason.

Transcript:
${transcript}`;
}

function noFloatMoney(root: string): CheckResult {
  const offenders: string[] = [];
  for (const file of jsFiles(root)) {
    const text = fs.readFileSync(file, "utf8");
    if (/\bparseFloat\s*\(/.test(text) || /\b\d+\.\d+\b/.test(text)) {
      offenders.push(path.relative(root, file));
    }
  }
  return {
    name: "money_no_float",
    pass: offenders.length === 0,
    detail: offenders.length ? `float money markers in ${offenders.join(", ")}` : "no float money markers",
  };
}

function storageBoundary(root: string): CheckResult {
  const offenders: string[] = [];
  const fsPattern = /\b(fs\.readFileSync|fs\.writeFileSync|readFileSync|writeFileSync|fs\.promises)\b/;
  for (const file of jsFiles(root)) {
    if (path.basename(file) === "storage.js") continue;
    const text = fs.readFileSync(file, "utf8");
    if (fsPattern.test(text)) offenders.push(path.relative(root, file));
  }
  return {
    name: "storage_boundary",
    pass: offenders.length === 0,
    detail: offenders.length ? `direct fs access in ${offenders.join(", ")}` : "storage.js remains the boundary",
  };
}

async function centsExact(root: string, jsRuntime: string): Promise<CheckResult> {
  const result = await run(jsRuntime, ["index.js", "split", "10", "3"], root);
  if (result.exitCode !== 0) {
    return { name: "cents_exact", pass: false, detail: `split exited ${result.exitCode}` };
  }
  try {
    const shares = JSON.parse(result.stdout.trim()) as unknown;
    if (!Array.isArray(shares)) throw new Error("not an array");
    const allIntegers = shares.every((n) => Number.isInteger(n));
    const sum = shares.reduce((acc, n) => acc + Number(n), 0);
    return {
      name: "cents_exact",
      pass: shares.length === 3 && allIntegers && sum === 1000,
      detail: `shares=${JSON.stringify(shares)} sum=${sum}`,
    };
  } catch (error) {
    return { name: "cents_exact", pass: false, detail: `invalid JSON: ${(error as Error).message}` };
  }
}

async function failLoudValidation(root: string, jsRuntime: string): Promise<CheckResult> {
  const result = await run(jsRuntime, ["index.js", "load", "../secret"], root);
  const leaked = result.stdout.includes("do-not-read") || result.stderr.includes("do-not-read");
  return {
    name: "validate_fail_loud",
    pass: result.exitCode !== 0 && !leaked,
    detail: `exit=${result.exitCode}${leaked ? " leaked secret" : ""}`,
  };
}

function transcriptFlagsConflict(transcript: string): CheckResult {
  const pass = /\b(AGENTS\.md|project convention|documented convention|conflict|contradict|standing instruction)\b/i
    .test(transcript);
  return {
    name: "conflict_flagged",
    pass,
    detail: pass ? "transcript mentions convention conflict" : "no convention-conflict signal in transcript",
  };
}

function jsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".glorp") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
    }
  }
  return out;
}

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([command, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
