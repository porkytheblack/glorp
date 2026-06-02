/**
 * Live smoke test: link an MCP Client to our server in-process (InMemoryTransport)
 * and exercise the orchestration tools against a real Station.
 *   GLORP_ENDPOINT=… GLORP_API_KEY=glsk_… bun scripts/smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { buildContext } from "../src/client.js";

function text(r: { content: Array<{ type: string; text?: string }>; isError?: boolean }): string {
  return (r.isError ? "ERROR " : "") + (r.content.map((c) => c.text).join("") || "");
}

const server = buildServer(buildContext());
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await server.connect(serverT);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(clientT);

const tools = (await client.listTools()).tools;
console.log(`tools advertised: ${tools.length} —`, tools.map((t) => t.name).join(", "));

const call = (name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args }).then((r) => text(r as never));

console.log("\nlist namespaces:\n" + (await call("glorp_list_namespaces")));
const created = await call("glorp_create_namespace", { name: "MCP Smoke" });
console.log("\ncreate ns 'MCP Smoke':\n" + created);
const id = JSON.parse(created).id as string; // reuse the actual id (handles collision suffixes)
console.log("\nmint key:\n" + (await call("glorp_mint_namespace_key", { id, name: "smoke-bot" })));
console.log(`\nlist sessions in ${id} (admin proxy):\n` + (await call("glorp_list_sessions", { namespace: id })));
console.log("\ndelete ns (data=true):\n" + (await call("glorp_delete_namespace", { id, removeData: true })));
console.log("\nlist namespaces (after):\n" + (await call("glorp_list_namespaces")));

await client.close();
await server.close();
console.log("\nSMOKE OK");
