/**
 * Streamable-HTTP transport (stateless): each POST /mcp gets a fresh server +
 * transport, so tool calls are independent request/response round-trips with no
 * server-side session state. Set MCP_AUTH_TOKEN to require a Bearer token on the
 * MCP endpoint itself (separate from the Glorp API key the tools use).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import type { McpContext } from "./client.js";

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) return resolve(undefined);
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: McpContext, token?: string): Promise<void> {
  if ((req.url ?? "").split("?")[0] !== "/mcp") return void res.writeHead(404).end();
  if (token && req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
  if (req.method !== "POST") {
    // Stateless server: no long-lived SSE (GET) or session teardown (DELETE).
    return void res.writeHead(405, { allow: "POST" }).end();
  }
  try {
    const body = await readJson(req);
    const server = buildServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }
}

export function startHttp(ctx: McpContext, host: string, port: number) {
  const token = process.env.MCP_AUTH_TOKEN;
  const httpServer = createServer((req, res) => void handle(req, res, ctx, token));
  httpServer.listen(port, host, () => {
    console.error(`[glorp-mcp] streamable HTTP listening on http://${host}:${port}/mcp`);
    if (!token) console.error("[glorp-mcp] WARNING: no MCP_AUTH_TOKEN set — the MCP endpoint is unauthenticated.");
  });
  return httpServer;
}
