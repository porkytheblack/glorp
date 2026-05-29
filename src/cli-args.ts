/**
 * CLI argument parsing — shared between all glorp modes.
 */

import * as path from "node:path";
import { GLORP_VERSION } from "./shared/version.ts";
import type { PermissionMode } from "./agent/runtime/permission-mode.ts";

export interface CliArgs {
  command: "tui" | "serve" | "headless" | "help" | "version" | "migrate";
  workspace: string;
  sessionId: string;
  provider?: string;
  model?: string;
  prompt?: string;
  port?: number;
  token?: string;
  permissionMode?: PermissionMode;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "tui",
    workspace: process.cwd(),
    sessionId: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "serve") { args.command = "serve"; continue; }
    if (a === "migrate") { args.command = "migrate"; continue; }
    if (a === "-h" || a === "--help") { args.command = "help"; continue; }
    if (a === "-v" || a === "--version") { args.command = "version"; continue; }
    if (a === "-C" || a === "--cwd") { args.workspace = path.resolve(argv[++i] ?? "."); continue; }
    if (a === "-s" || a === "--session") { args.sessionId = argv[++i] ?? ""; continue; }
    if (a === "--provider") { args.provider = argv[++i]; continue; }
    if (a === "-m" || a === "--model") { args.model = argv[++i]; continue; }
    if (a === "--port") { args.port = Number(argv[++i]); continue; }
    if (a === "--token") { args.token = argv[++i]; continue; }
    if (a === "-p" || a === "--print") {
      args.command = "headless";
      args.prompt = argv[++i];
      continue;
    }
    if (a === "--auto-mode") { args.permissionMode = "auto"; continue; }
    if (a === "--bypass") { args.permissionMode = "bypass"; continue; }
    if (!a.startsWith("-")) {
      args.prompt = args.prompt ? `${args.prompt} ${a}` : a;
    }
  }
  return args;
}

export const HELP_TEXT = `glorp — alien coding agent (v${GLORP_VERSION})

USAGE
  glorp [options] [prompt...]       Interactive TUI (starts server if needed)
  glorp serve [options]             Start the agent server only
  glorp migrate                     Upgrade stored sessions to the latest schema
  glorp -p "prompt"                 One-shot headless mode

OPTIONS
  -C, --cwd <dir>          Workspace root (default: cwd)
  -s, --session <id>       Resume a session by ID
      --provider <name>    LLM provider (anthropic|openai|openrouter|gemini|…)
  -m, --model <name>       Model name override
      --port <port>        Server port (default: 3271)
      --token <token>      Bearer token for server auth
  -p, --print <prompt>     Run one prompt, print result, exit
      --auto-mode          Auto-approve safe ops; escalate destructive only
      --bypass             No permission prompts at all (⚠ use with caution)
  -v, --version            Print version
  -h, --help               This help

ENV
  ANTHROPIC_API_KEY        Default provider if set
  GLORP_PORT               Override server port
  GLORP_TOKEN              Override server token
  GLORP_DATA_DIR           Override storage (default ~/.glorp)

KEYBOARD (in TUI)
  Ctrl+M  Model switcher     Ctrl+S  Session picker
  Ctrl+B  Toggle sidebar     Ctrl+?  Help
  Ctrl+C  Abort / quit       Ctrl+R  Toggle reasoning
`;
