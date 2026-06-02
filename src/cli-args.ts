/**
 * CLI argument parsing — shared between all glorp modes.
 */

import * as path from "node:path";
import { GLORP_VERSION } from "./shared/version.ts";
import type { PermissionMode } from "./agent/runtime/permission-mode.ts";

export interface CliArgs {
  command: "tui" | "serve" | "station" | "headless" | "help" | "version" | "migrate" | "doctor" | "mesh";
  workspace: string;
  sessionId: string;
  provider?: string;
  model?: string;
  prompt?: string;
  port?: number;
  token?: string;
  permissionMode?: PermissionMode;
  /** `glorp doctor --kill`: terminate the stale glorp processes it finds. */
  doctorKill?: boolean;
  /** `glorp mesh <sub>`: subcommand (agents | log | summary). */
  meshSub?: string;
  /** Station: bind hostname. */
  host?: string;
  /** Station: override data dir. */
  dataDir?: string;
  /** Station: base directory for auto-provisioned workspaces. */
  workspaceRoot?: string;
  /** `glorp station keys <sub>`: manage API keys (add | list | revoke). */
  stationKeysSub?: "add" | "list" | "revoke";
  /** `keys add <name>`. */
  keyName?: string;
  /** `keys revoke <id>`. */
  keyId?: string;
  /** `--scopes a,b,c` for `keys add`. */
  scopes?: string[];
  /** `--namespace <id>` for `keys add`: bind the key to a tenant namespace. */
  namespace?: string;
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
    if (a === "station") {
      args.command = "station";
      if (argv[i + 1] === "keys") {
        i++;
        const sub = argv[i + 1];
        args.stationKeysSub = sub === "add" || sub === "revoke" ? sub : "list";
        if (sub === "add" || sub === "list" || sub === "revoke") i++;
        const pos = argv[i + 1];
        if (pos && !pos.startsWith("-")) {
          if (args.stationKeysSub === "add") args.keyName = pos;
          else if (args.stationKeysSub === "revoke") args.keyId = pos;
          i++;
        }
      }
      continue;
    }
    if (a === "migrate") { args.command = "migrate"; continue; }
    if (a === "doctor") { args.command = "doctor"; continue; }
    if (a === "mesh") {
      args.command = "mesh";
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { args.meshSub = next; i++; }
      continue;
    }
    if (a === "--kill") { args.doctorKill = true; continue; }
    if (a === "-h" || a === "--help") { args.command = "help"; continue; }
    if (a === "-v" || a === "--version") { args.command = "version"; continue; }
    if (a === "-C" || a === "--cwd") { args.workspace = path.resolve(argv[++i] ?? "."); continue; }
    if (a === "-s" || a === "--session") { args.sessionId = argv[++i] ?? ""; continue; }
    if (a === "--provider") { args.provider = argv[++i]; continue; }
    if (a === "-m" || a === "--model") { args.model = argv[++i]; continue; }
    if (a === "--port") { args.port = Number(argv[++i]); continue; }
    if (a === "--token") { args.token = argv[++i]; continue; }
    if (a === "--host") { args.host = argv[++i]; continue; }
    if (a === "--data-dir") { args.dataDir = argv[++i]; continue; }
    if (a === "--workspace-root") { args.workspaceRoot = path.resolve(argv[++i] ?? "."); continue; }
    if (a === "--scopes") { args.scopes = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean); continue; }
    if (a === "--namespace") { args.namespace = argv[++i]; continue; }
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
  glorp station [options]           Start the multi-session Station runtime
  glorp station keys add <name>     Create an API key (printed once)
  glorp station keys list|revoke    Manage API keys
  glorp migrate                     Upgrade stored sessions to the latest schema
  glorp doctor [--kill]             Diagnose / clean up stale glorp processes & state
  glorp mesh [agents|log]           Inspect the inter-agent mesh history
  glorp -p "prompt"                 One-shot headless mode

OPTIONS
  -C, --cwd <dir>          Workspace root (default: cwd)
  -s, --session <id>       Resume a session by ID
      --provider <name>    LLM provider (anthropic|openai|openrouter|gemini|…)
  -m, --model <name>       Model name override
      --port <port>        Server port (serve: 3271, station: 4271)
      --token <token>      Bearer token for server auth
  -p, --print <prompt>     Run one prompt, print result, exit
      --auto-mode          Auto-approve safe ops; escalate destructive only
      --bypass             No permission prompts at all (⚠ use with caution)
  -v, --version            Print version
  -h, --help               This help

STATION OPTIONS
      --host <addr>        Bind address (default: 127.0.0.1; non-loopback ⇒ auth required)
      --data-dir <dir>     State directory (default: ~/.glorp)
      --workspace-root <d> Base dir for auto-provisioned workspaces
      --scopes <a,b>       Scopes for 'keys add' (default: admin)
      --namespace <id>     Bind a 'keys add' key to a tenant namespace

ENV
  ANTHROPIC_API_KEY        Default provider if set
  GLORP_PORT               Override server port
  GLORP_TOKEN              Override server token
  GLORP_DATA_DIR           Override storage (default ~/.glorp)
  GLORP_STATION_AUTH       Station API-key auth: required | off (default: auto)

KEYBOARD (in TUI)
  Ctrl+M  Model switcher     Ctrl+S  Session picker
  Ctrl+B  Toggle sidebar     Ctrl+?  Help
  Ctrl+C  Abort / quit       Ctrl+R  Toggle reasoning
`;
