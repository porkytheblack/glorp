/**
 * Audit the streamable-HTTP transport with a REAL MCP client: connect (which does
 * the initialize handshake), then list tools and call one — as separate POSTs.
 * This is the true test of the stateless server (a single curl initialize isn't).
 *   MCP_URL=http://127.0.0.1:8801/mcp bun scripts/audit-http.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://127.0.0.1:8801/mcp");
const client = new Client({ name: "audit-http", version: "0" });
await client.connect(new StreamableHTTPClientTransport(url));
console.log("connected (initialize OK)");

const tools = await client.listTools();
console.log(`listTools OK: ${tools.tools.length} tools`);

const r = (await client.callTool({ name: "glorp_list_namespaces", arguments: {} })) as {
  content: Array<{ text?: string }>;
  isError?: boolean;
};
console.log("callTool glorp_list_namespaces:", r.isError ? "ERROR" : "OK");
console.log((r.content?.[0]?.text ?? "").slice(0, 200));

await client.close();
console.log("HTTP AUDIT OK");
