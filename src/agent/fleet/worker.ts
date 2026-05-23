import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import { spawn } from "node:child_process";
import { MemoryStore } from "../memory-store-shim.ts";
import { pickModel } from "../model-picker.ts";
import { CredentialsStore } from "../credentials.ts";
import { loadPrompt } from "../prompts.ts";
import { SIGNAL_SCHEMAS, type FleetInput } from "./signals.ts";
import type { FleetSignalKind, FleetJobConfig } from "./types.ts";

interface WorkerCommand {
  kind: FleetSignalKind;
  input: FleetInput;
  config: FleetJobConfig;
}

interface WorkerReply {
  ok: boolean;
  response: string;
}

/**
 * Entry point for the `--worker` subcommand. Reads a single JSON line from
 * stdin, runs the matching handler, prints a single JSON line to stdout, and
 * exits. Parent process owns the lifecycle; the child terminates after one
 * job and is replaced by a fresh spawn on the next dispatch.
 */
export async function runFleetWorker(): Promise<void> {
  const command = await readCommand();
  const parsed = SIGNAL_SCHEMAS[command.kind].inputSchema.safeParse(command.input);
  if (!parsed.success) {
    writeReply({ ok: false, response: `invalid input: ${parsed.error.message}` });
    process.exit(2);
  }
  const reply = await runHandler(command.kind, parsed.data, command.config);
  writeReply(reply);
  process.exit(reply.ok ? 0 : 1);
}

async function readCommand(): Promise<WorkerCommand> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(raw) as WorkerCommand;
}

function writeReply(reply: WorkerReply): void {
  process.stdout.write(JSON.stringify(reply));
}

async function runHandler(
  kind: FleetSignalKind,
  input: FleetInput,
  config: FleetJobConfig,
): Promise<WorkerReply> {
  try {
    if (kind === "research") return { ok: true, response: await runResearch(input, config) };
    if (kind === "shell-fanout" || kind === "edit-fanout") {
      const timeout = kind === "shell-fanout" ? 120_000 : 60_000;
      const result = await runShell(input.payload, config.workspace, timeout);
      return {
        ok: result.exitCode === 0,
        response: formatShellResult(result),
      };
    }
    return { ok: false, response: `unknown signal kind: ${kind}` };
  } catch (err: any) {
    return { ok: false, response: `worker failed: ${err?.message ?? String(err)}` };
  }
}

async function runResearch(input: FleetInput, config: FleetJobConfig): Promise<string> {
  const credentials = new CredentialsStore(config.dataDir);
  const picked = await pickModel({
    provider: config.provider,
    model: config.model,
    credentials,
  });
  const child = new Glove({
    store: new MemoryStore(`fleet_research_${input.itemId}`),
    model: picked.adapter,
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: loadPrompt("fleet-research"),
    compaction_config: {
      compaction_instructions: "Keep research findings; drop chatter.",
      max_turns: 8,
    },
    enableToolResultSummary: true,
  }).build();
  const result = await child.processRequest(input.payload);
  return "messages" in result
    ? result.messages.at(-1)?.text ?? "(no response)"
    : (result as { text?: string }).text ?? "(no response)";
}

interface ShellRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runShell(cmd: string, cwd: string, timeoutMs: number): Promise<ShellRunResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", cmd], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf-8")));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString("utf-8")));
    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 1500);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.on("error", () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode: -1, stdout, stderr: stderr + "\n[spawn failed]" });
    });
  });
}

function formatShellResult(r: ShellRunResult): string {
  return [
    `exit=${r.exitCode}`,
    r.stdout ? `stdout:\n${r.stdout.slice(0, 4000)}` : "",
    r.stderr ? `stderr:\n${r.stderr.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n");
}
