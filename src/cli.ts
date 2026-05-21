#!/usr/bin/env bun
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { App } from "./ui/app.tsx";
import { buildGlorp } from "./agent/glorp.ts";
import { GLORP_VERSION } from "./shared/version.ts";

interface Args {
  workspace: string;
  sessionId: string;
  provider?: string;
  model?: string;
  prompt?: string;
  printOnly: boolean;
  showHelp: boolean;
  showVersion: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    workspace: process.cwd(),
    sessionId: defaultSessionId(),
    printOnly: false,
    showHelp: false,
    showVersion: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") args.showHelp = true;
    else if (a === "-v" || a === "--version") args.showVersion = true;
    else if (a === "-C" || a === "--cwd") args.workspace = path.resolve(argv[++i] ?? ".");
    else if (a === "-s" || a === "--session") args.sessionId = argv[++i] ?? args.sessionId;
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "-m" || a === "--model") args.model = argv[++i];
    else if (a === "-p" || a === "--print") {
      args.printOnly = true;
      args.prompt = argv[++i];
    } else if (!a.startsWith("-")) {
      // First positional argument is treated as the initial prompt.
      args.prompt = args.prompt ? `${args.prompt} ${a}` : a;
    }
  }
  return args;
}

function defaultSessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const HELP = `glorp — alien coding agent (v${GLORP_VERSION})

USAGE
  glorp [options] [prompt...]
  glorp -p "single one-shot prompt"

OPTIONS
  -C, --cwd <dir>          Workspace root (default: cwd)
  -s, --session <id>       Resume a session by ID (default: timestamp)
      --provider <name>    LLM provider (anthropic|openai|openrouter|gemini|…)
  -m, --model <name>       Model name override
  -p, --print <prompt>     Run one prompt, print result to stdout, exit
  -v, --version            Print version
  -h, --help               This help

ENV
  ANTHROPIC_API_KEY        Used by default if set
  OPENAI_API_KEY           Falls back if no Anthropic key
  OPENROUTER_API_KEY       Falls back if no OpenAI key
  GLORP_DATA_DIR           Override session storage (default ~/.glorp)

SLASH COMMANDS (inside the TUI)
  /plan        Switch to plan-first mode for this turn
  /diff        List files changed since last user message
  /compact     Force a context compaction now
  /clear       Compact and reset the working slate
  /concise     Be terser
  /transmissions  Ask about the homeworld-comms panel
  /quit        Exit glorp

SUBAGENTS
  @planner    Design an approach without writing code
  @researcher Investigate the codebase or fetch docs
  @reviewer   Review a recent change before shipping
`;

async function runHeadless(args: Args): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  ensureApiKey(args);
  const glorp = await buildGlorp({
    workspace: args.workspace,
    sessionId: args.sessionId,
    dataDir,
    provider: args.provider,
    model: args.model,
  });
  // In print mode, stream text to stdout as it arrives, then print the final.
  process.stdout.write(`glorp> `);
  const { getBridge } = await import("./shared/bridge.ts");
  let final = "";
  getBridge().subscribe((ev) => {
    if (ev.type === "text_delta") process.stdout.write(ev.text);
    if (ev.type === "turn" && ev.turn.kind === "agent") final = ev.turn.text ?? "";
    if (ev.type === "tool_started")
      process.stdout.write(`\n  [${ev.tool.name}] ${describeInput(ev.tool.input)}\n`);
    if (ev.type === "tool_finished") {
      const ok = ev.tool.status === "success";
      process.stdout.write(
        `\n  ${ok ? "✓" : "✗"} ${ev.tool.name} ${ok ? "" : `— ${ev.tool.output?.slice(0, 200) ?? ""}`}\n`,
      );
    }
    if (ev.type === "transmission")
      process.stderr.write(`\n[transmission] ${ev.payload}\n`);
  });
  await glorp.send(args.prompt!);
  process.stdout.write("\n");
  await glorp.shutdown();
  // The streaming subscriber above wrote agent text + tool events to stdout
  // in real time, so there's nothing else to print here. `final` is kept
  // around for the headless contract — if a future caller wants the final
  // text as a single string, expose it; for now stdout is the contract.
  void final;
}

function describeInput(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch {
    return String(input);
  }
}

async function runTui(args: Args): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  ensureApiKey(args);
  fs.mkdirSync(dataDir, { recursive: true });
  const glorp = await buildGlorp({
    workspace: args.workspace,
    sessionId: args.sessionId,
    dataDir,
    provider: args.provider,
    model: args.model,
  });
  const modelLabel = args.model ?? args.provider ?? guessProviderLabel();

  const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false,
  });

  let stopped = false;
  const onQuit = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await glorp.shutdown();
    } finally {
      renderer.destroy();
      process.exit(0);
    }
  };

  // Forward an initial prompt if the user gave one as positional args.
  if (args.prompt) {
    queueMicrotask(() => void glorp.send(args.prompt!));
  }

  createRoot(renderer).render(
    React.createElement(App, {
      glorp,
      workspace: args.workspace,
      model: modelLabel,
      onQuit,
    }),
  );

  process.on("SIGINT", () => void onQuit());
  process.on("SIGTERM", () => void onQuit());
}

function ensureApiKey(args: Args): void {
  const provider =
    args.provider ??
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.OPENROUTER_API_KEY
          ? "openrouter"
          : process.env.GEMINI_API_KEY
            ? "gemini"
            : null);
  if (!provider) {
    console.error(`
glorp needs an LLM API key to do anything useful.

set one of:
  ANTHROPIC_API_KEY  (recommended — sonnet/opus)
  OPENAI_API_KEY     (gpt-4.1)
  OPENROUTER_API_KEY (any model via openrouter)
  GEMINI_API_KEY     (gemini-2.5-flash)
  GROQ_API_KEY       (llama-3.3-70b, fast)

then re-run glorp.
`);
    process.exit(2);
  }
}

function guessProviderLabel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "(no API key configured)";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    console.log(HELP);
    return;
  }
  if (args.showVersion) {
    console.log(`glorp ${GLORP_VERSION}`);
    return;
  }
  if (args.printOnly) {
    await runHeadless(args);
    return;
  }
  await runTui(args);
}

main().catch((err) => {
  console.error("glorp crashed:", err);
  process.exit(1);
});
