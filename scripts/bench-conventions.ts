#!/usr/bin/env bun
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CONVENTION_PROMPT,
  createConventionFixture,
} from "../src/benchmarks/convention-fixture.ts";
import {
  gradeConventionFixture,
  judgePrompt,
  type ConventionGrade,
} from "../src/benchmarks/convention-grader.ts";

interface Args {
  runs: number;
  keep: boolean;
  provider?: string;
  model?: string;
  json: boolean;
  timeoutMs: number;
  agentCommand?: string;
}

interface RunResult {
  run: number;
  root: string;
  exitCode: number;
  transcript: string;
  grade: ConventionGrade;
}

const args = parseArgs(process.argv.slice(2));
const results: RunResult[] = [];

for (let i = 1; i <= args.runs; i++) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `glorp-conventions-${i}-`));
  createConventionFixture(root);
  const agent = await runAgent(root, args);
  const grade = await gradeConventionFixture(root, agent.transcript);
  results.push({ run: i, root, exitCode: agent.exitCode, transcript: agent.transcript, grade });
  if (!args.keep) fs.rmSync(root, { recursive: true, force: true });
}

if (args.json) {
  console.log(JSON.stringify({ prompt: CONVENTION_PROMPT, results }, null, 2));
} else {
  printReport(results);
}

function parseArgs(argv: string[]): Args {
  const out: Args = { runs: 3, keep: false, json: false, timeoutMs: 600_000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--runs") out.runs = Number(argv[++i] ?? out.runs);
    else if (arg === "--keep") out.keep = true;
    else if (arg === "--provider") out.provider = argv[++i];
    else if (arg === "--model") out.model = argv[++i];
    else if (arg === "--json") out.json = true;
    else if (arg === "--timeout-ms") out.timeoutMs = Number(argv[++i] ?? out.timeoutMs);
    else if (arg === "--agent-command") out.agentCommand = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(help());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error("--runs must be >= 1");
  return out;
}

async function runAgent(root: string, opts: Args): Promise<{ exitCode: number; transcript: string }> {
  const dataDir = path.join(root, ".glorp");
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const proc = opts.agentCommand
    ? Bun.spawn(["sh", "-lc", renderTemplate(opts.agentCommand, root)], spawnOpts(root, dataDir, timeout))
    : Bun.spawn(defaultCommand(root, opts), spawnOpts(root, dataDir, timeout));
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, transcript: `${stdout}\n${stderr}` };
}

function defaultCommand(root: string, opts: Args): string[] {
  const cmd = [process.execPath, "src/cli.ts", "-C", root, "-p", CONVENTION_PROMPT];
  if (opts.provider) cmd.push("--provider", opts.provider);
  if (opts.model) cmd.push("--model", opts.model);
  return cmd;
}

function spawnOpts(root: string, dataDir: string, signal: AbortSignal): Bun.SpawnOptions.OptionsObject<"pipe", "pipe", "inherit"> {
  return {
    cwd: path.resolve("."),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
    signal,
    env: {
      ...process.env,
      GLORP_DATA_DIR: dataDir,
      GLORP_BENCH_WORKSPACE: root,
    },
  };
}

function renderTemplate(template: string, root: string): string {
  return template
    .replaceAll("{workspace}", shellQuote(root))
    .replaceAll("{prompt}", shellQuote(CONVENTION_PROMPT));
}

function printReport(results: RunResult[]): void {
  const names = results[0]?.grade.checks.map((c) => c.name) ?? [];
  console.log(`# Convention Landmine Benchmark`);
  console.log(`runs: ${results.length}`);
  console.log(`prompt: ${CONVENTION_PROMPT}`);
  console.log("");
  console.log("| check | pass rate |");
  console.log("|---|---:|");
  for (const name of names) {
    const passed = results.filter((r) => r.grade.checks.find((c) => c.name === name)?.pass).length;
    console.log(`| ${name} | ${passed}/${results.length} |`);
  }
  const hardPassed = results.filter((r) => r.grade.hardPass).length;
  const allPassed = results.filter((r) => r.grade.pass).length;
  console.log(`| hard_checks | ${hardPassed}/${results.length} |`);
  console.log(`| all_checks | ${allPassed}/${results.length} |`);
  console.log("");
  for (const result of results) {
    const failed = result.grade.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
    console.log(`run ${result.run}: exit=${result.exitCode} ${failed.length ? `FAIL ${failed.join("; ")}` : "PASS"}`);
    if (failed.some((f) => f.startsWith("conflict_flagged"))) {
      console.log(`judge prompt:\n${judgePrompt(result.transcript).slice(0, 1200)}\n`);
    }
    if (args.keep) console.log(`fixture: ${result.root}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function help(): string {
  return `Usage: bun scripts/bench-conventions.ts [options]

Runs a convention-loading landmine benchmark against Glorp.

Options:
  --runs <n>              Number of fresh fixture runs (default: 3)
  --provider <name>       Provider passed to Glorp
  --model <name>          Model passed to Glorp
  --agent-command <cmd>   Shell template using {workspace} and {prompt}
  --timeout-ms <n>        Per-run timeout (default: 600000)
  --json                  Print full JSON results
  --keep                  Keep fixture directories for inspection
`;
}
