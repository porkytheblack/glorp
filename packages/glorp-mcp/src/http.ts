/**
 * Streamable-HTTP transport (stateless), served by Hono via @hono/node-server:
 * each POST /mcp gets a fresh MCP server + transport, so tool calls are
 * independent request/response round-trips with no server-side session state.
 * The MCP SDK transport writes directly to the Node response, so we hand it the
 * raw `incoming`/`outgoing` from Hono's Node bindings. Set MCP_AUTH_TOKEN to
 * require a Bearer token on the endpoint itself (separate from the Glorp API
 * key the tools use).
 */

import { serve, type HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { Hono } from "hono";
import type { Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import type { McpContext } from "./client.js";

/** Cap on the request body — 413 beyond this. Keeps a client from buffering us OOM. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

type Bindings = { Bindings: HttpBindings };

/** Parse the JSON body once (the transport reuses the parsed value, not the stream). */
async function parseBody(text: string): Promise<unknown> {
  if (!text) return undefined;
  return JSON.parse(text);
}

/** Bind the HTTP server; resolves once listening, rejects on a bind error. */
export function startHttp(ctx: McpContext, host: string, port: number): Promise<Server> {
  const token = process.env.MCP_AUTH_TOKEN;
  const app = new Hono<Bindings>();

  app.post("/mcp", async (c) => {
    if (token && c.req.header("authorization") !== `Bearer ${token}`) return c.body(null, 401);
    // Enforce the body cap up front. We buffer the whole body (the SDK transport
    // reuses the parsed value), so require a declared, in-bounds Content-Length
    // rather than streaming unbounded — a missing or oversized length is rejected.
    const declared = c.req.header("content-length");
    if (declared === undefined) {
      return c.json({ error: "Content-Length header is required" }, 411);
    }
    if (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES) {
      return c.json({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes` }, 413);
    }
    let body: unknown;
    try {
      body = await parseBody(await c.req.text());
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const { incoming, outgoing } = c.env;
    const server = buildServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(incoming, outgoing, body);
    } catch (err) {
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    }
    return RESPONSE_ALREADY_SENT;
  });

  // Stateless server: no long-lived SSE (GET) or session teardown (DELETE).
  app.all("/mcp", (c) => c.body(null, 405, { allow: "POST" }));
  app.all("*", (c) => c.body(null, 404));

  return new Promise<Server>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
      console.error(`[glorp-mcp] streamable HTTP listening on http://${host}:${info.port}/mcp`);
      if (!token) console.error("[glorp-mcp] WARNING: no MCP_AUTH_TOKEN set — the MCP endpoint is unauthenticated.");
      resolve(server as unknown as Server);
    }) as unknown as Server;
    // Before `listening` this is a bind failure (EADDRINUSE/EACCES) → reject;
    // after, the promise is already settled, so this just logs (no crash).
    server.on("error", (err: Error) => {
      console.error("[glorp-mcp] http server error:", err.message);
      reject(err);
    });
  });
}
