/**
 * Streamable-HTTP transport (stateless): each POST /mcp gets a fresh server +
 * transport, so tool calls are independent request/response round-trips with no
 * server-side session state. Set MCP_AUTH_TOKEN to require a Bearer token on the
 * MCP endpoint itself (separate from the Glorp API key the tools use).
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import type { McpContext } from "./client.js";

/** Cap on the request body — 413 beyond this. Keeps a client from buffering us OOM. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** An error carrying the HTTP status the handler should return. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Read + parse a JSON body with a size cap; rejects HttpError(413|400). */
function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new HttpError(413, `Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) return resolve(undefined);
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(new HttpError(400, err.message)));
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
    const status = err instanceof HttpError ? err.status : 500;
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }
}

/** Bind the HTTP server; resolves once listening, rejects on a bind error. */
export function startHttp(ctx: McpContext, host: string, port: number): Promise<Server> {
  const token = process.env.MCP_AUTH_TOKEN;
  const httpServer = createServer((req, res) => void handle(req, res, ctx, token));
  return new Promise<Server>((resolve, reject) => {
    httpServer.on("error", (err) => {
      // Before `listening`, this is a bind failure (EADDRINUSE/EACCES) → reject.
      // After, the promise is already settled, so this just logs (no crash).
      console.error("[glorp-mcp] http server error:", err instanceof Error ? err.message : err);
      reject(err);
    });
    httpServer.listen(port, host, () => {
      console.error(`[glorp-mcp] streamable HTTP listening on http://${host}:${port}/mcp`);
      if (!token) console.error("[glorp-mcp] WARNING: no MCP_AUTH_TOKEN set — the MCP endpoint is unauthenticated.");
      resolve(httpServer);
    });
  });
}
