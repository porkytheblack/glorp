import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateProvider } from "../src/mcpgen/generate.ts";
import type { ProviderSpec, ToolDef } from "../src/mcpgen/types.ts";

let ws: string;
let server: ReturnType<typeof Bun.serve> | null = null;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "mcpgen-rt-"));
});
afterEach(() => {
  server?.stop(true);
  server = null;
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {}
});

// Minimal MCP Streamable-HTTP mock. Echoes the bearer token so the test can
// assert which identity authenticated; tools/call replies as an SSE stream.
function startMock() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const auth = req.headers.get("authorization") ?? "";
      const body = (await req.json()) as { id?: number; method: string; params?: any };
      if (body.method === "initialize") {
        return Response.json(
          { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mock", version: "1" } } },
          { headers: { "mcp-session-id": "sess-1" } },
        );
      }
      if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
      if (body.method === "tools/call") {
        const payload = {
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ tool: body.params.name, auth, args: body.params.arguments }) }] },
        };
        return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
    },
  });
}

function specFor(url: string): ProviderSpec {
  return {
    provider: "linear",
    url,
    defaultIdentity: "acme",
    identities: [
      { name: "acme", token: "TOKEN_ACME" },
      { name: "personal", token: "TOKEN_PERSONAL" },
    ],
  };
}

const tools: ToolDef[] = [
  { name: "create_issue", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
];

async function loadClient() {
  return import(path.join(ws, "mcp/_runtime/client.ts")) as Promise<typeof import("../src/mcpgen/emitted/client.ts")>;
}

describe("emitted runtime client", () => {
  test("default identity authenticates and returns the tool result (over SSE)", async () => {
    server = startMock();
    generateProvider(ws, specFor(`http://127.0.0.1:${server.port}/mcp`), tools);
    const client = await loadClient();
    const res = (await client.callTool({ provider: "linear", tool: "create_issue" }, { title: "Hi" })) as any;
    const echoed = JSON.parse(res.content[0].text);
    expect(echoed.auth).toBe("Bearer TOKEN_ACME");
    expect(echoed.tool).toBe("create_issue");
    expect(echoed.args).toEqual({ title: "Hi" });
  });

  test("explicit identity overrides the default", async () => {
    server = startMock();
    generateProvider(ws, specFor(`http://127.0.0.1:${server.port}/mcp`), tools);
    const client = await loadClient();
    const res = (await client.callTool({ provider: "linear", tool: "create_issue", identity: "personal" }, { title: "Hi" })) as any;
    expect(JSON.parse(res.content[0].text).auth).toBe("Bearer TOKEN_PERSONAL");
  });

  test("resolveIdentity falls back to the first identity when no default is set", async () => {
    server = startMock();
    const spec = specFor(`http://127.0.0.1:${server.port}/mcp`);
    spec.defaultIdentity = undefined;
    generateProvider(ws, spec, tools);
    const client = await loadClient();
    expect(client.resolveIdentity("linear").name).toBe("acme");
  });
});
