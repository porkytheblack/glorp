/**
 * CLI serve mode: starts the Glorp agent server in the foreground.
 * Logs to stderr, binds to localhost, writes discovery file.
 */

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { startServer } from "./server/server.ts";
import { GLORP_VERSION } from "./shared/version.ts";
import type { CliArgs } from "./cli-args.ts";

export async function runServe(args: CliArgs): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  fs.mkdirSync(dataDir, { recursive: true });

  const port = args.port ?? (process.env.GLORP_PORT ? Number(process.env.GLORP_PORT) : undefined);
  const token = args.token ?? process.env.GLORP_TOKEN;

  console.error(`glorp server v${GLORP_VERSION}`);
  console.error(`workspace: ${args.workspace}`);
  console.error(`data dir:  ${dataDir}`);

  const server = await startServer({
    workspace: args.workspace,
    dataDir,
    port,
    token,
    provider: args.provider,
    model: args.model,
    permissionMode: args.permissionMode,
  });

  console.error(`listening on http://127.0.0.1:${server.port}`);
  if (token) console.error(`auth:      bearer token required`);
  console.error(`\npress Ctrl+C to stop\n`);

  const shutdown = async () => {
    console.error("\nshutting down...");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
