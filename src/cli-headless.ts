/**
 * CLI headless mode: connect to the server, send one prompt, stream
 * the result to stdout, then exit. Used with `glorp -p "prompt"`.
 *
 * If no server is running, starts an embedded one.
 */

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { GlorpClient } from "./client/client.ts";
import { discoverServer, serverUrl } from "./client/discovery.ts";
import { startServer } from "./server/server.ts";
import { newSessionId } from "./agent/sessions.ts";
import type { CliArgs } from "./cli-args.ts";

export async function runHeadless(args: CliArgs): Promise<void> {
  if (!args.prompt) {
    console.error("glorp: -p requires a prompt argument");
    process.exit(2);
  }

  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  fs.mkdirSync(dataDir, { recursive: true });

  // Find or start a server.
  let url: string;
  let stopServer: (() => Promise<void>) | null = null;
  const existing = await discoverServer(dataDir);
  if (existing) {
    url = serverUrl(existing);
  } else {
    const port = args.port ?? (process.env.GLORP_PORT ? Number(process.env.GLORP_PORT) : undefined);
    const srv = await startServer({
      workspace: args.workspace, dataDir, port,
      token: args.token ?? process.env.GLORP_TOKEN,
      provider: args.provider, model: args.model,
      permissionMode: args.permissionMode,
    });
    url = `http://127.0.0.1:${srv.port}`;
    stopServer = srv.stop;
  }

  const client = new GlorpClient({
    url,
    clientId: `headless_${Date.now().toString(36)}`,
    clientName: "glorp-headless",
    token: args.token ?? process.env.GLORP_TOKEN,
  });

  try {
    const { session_id } = await client.createSession({
      session_id: args.sessionId || undefined,
      provider: args.provider,
      model: args.model,
    });

    process.stdout.write("glorp> ");
    await new Promise<void>((resolve, reject) => {
      let done = false;
      client.subscribe((msg) => {
        if (msg.type === "text_delta") process.stdout.write(msg.text);
        if (msg.type === "tool_started") {
          const t = (msg as any).tool;
          process.stdout.write(`\n  [${t.name}] ${summarise(t.input)}\n`);
        }
        if (msg.type === "tool_finished") {
          const t = (msg as any).tool;
          const ok = t.status === "success";
          process.stdout.write(`  ${ok ? "✓" : "✗"} ${t.name}\n`);
        }
        if (msg.type === "error") process.stderr.write(`\n[error] ${msg.message}\n`);
        if (msg.type === "busy" && !(msg as any).busy && done) resolve();
        if (msg.type === "turn" && (msg as any).turn?.kind === "agent") done = true;
      });
      client.connect(session_id);
      // Wait for connection, then send
      const unsub = client.onStateChange((s) => {
        if (s === "connected") {
          unsub();
          client.send(args.prompt!);
        }
      });
      setTimeout(() => reject(new Error("timeout: no response in 5 minutes")), 300_000);
    });
    process.stdout.write("\n");
  } finally {
    client.disconnect();
    if (stopServer) await stopServer();
  }
}

function summarise(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch { return String(input); }
}
