#!/usr/bin/env node
/**
 * Glorp MCP server entry point.
 *
 *   glorp-mcp                 # stdio transport (default — for Claude Desktop/Code etc.)
 *   glorp-mcp --http          # streamable HTTP on 127.0.0.1:8787 (/mcp)
 *   glorp-mcp --http --host 0.0.0.0 --port 9000
 *
 * Config via env: GLORP_ENDPOINT (required), GLORP_API_KEY, GLORP_NAMESPACE,
 * and (HTTP only) MCP_AUTH_TOKEN. In stdio mode, NEVER write to stdout — the
 * protocol owns it, so all logging goes to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { buildContext } from "./client.js";
import { startHttp } from "./http.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ctx = buildContext();

  if (args.includes("--http")) {
    const host = flag(args, "--host") ?? "127.0.0.1";
    const port = Number(flag(args, "--port") ?? process.env.PORT ?? 8787);
    startHttp(ctx, host, port);
    return;
  }

  const server = buildServer(ctx);
  await server.connect(new StdioServerTransport());
  console.error("[glorp-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[glorp-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
