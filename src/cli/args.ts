import * as path from "node:path";

export interface Args {
  workspace: string;
  sessionId: string;
  provider?: string;
  model?: string;
  prompt?: string;
  printOnly: boolean;
  showHelp: boolean;
  showVersion: boolean;
  worker: boolean;
}

/**
 * Tiny argv parser. We intentionally avoid a dependency — every flag is
 * documented in `src/cli/help.ts` and the parser is short enough to audit
 * at a glance.
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = {
    workspace: process.cwd(),
    sessionId: "",
    printOnly: false,
    showHelp: false,
    showVersion: false,
    worker: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") args.showHelp = true;
    else if (a === "-v" || a === "--version") args.showVersion = true;
    else if (a === "--worker") args.worker = true;
    else if (a === "-C" || a === "--cwd") args.workspace = path.resolve(argv[++i] ?? ".");
    else if (a === "-s" || a === "--session") args.sessionId = argv[++i] ?? args.sessionId;
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "-m" || a === "--model") args.model = argv[++i];
    else if (a === "-p" || a === "--print") {
      args.printOnly = true;
      args.prompt = argv[++i];
    } else if (!a.startsWith("-")) {
      args.prompt = args.prompt ? `${args.prompt} ${a}` : a;
    }
  }
  return args;
}
