/**
 * Audit the tools the smoke test didn't cover: workspaces, the headline run,
 * session get/agents/destroy. One real (cheap) model turn proves glorp_run.
 *   GLORP_ENDPOINT=… GLORP_API_KEY=glsk_… bun scripts/audit-stdio.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { buildContext } from "../src/client.js";

const server = buildServer(buildContext());
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: "audit-stdio", version: "0" });
await client.connect(ct);

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text?: string }>;
    isError?: boolean;
  };
  const text = r.content?.[0]?.text ?? "";
  console.log(`\n• ${name}${r.isError ? " [ERROR]" : ""}\n${text.slice(0, 300)}`);
  return { text, isError: !!r.isError };
}

// Workspaces (default namespace — unconfined)
await call("glorp_create_workspace", { path: "/workspaces/mcp-audit-ws", name: "MCP Audit WS" });
await call("glorp_list_workspaces");

// Headline run: one tiny real turn (bypass = no prompts; container sandbox).
const run = await call("glorp_run", {
  prompt: "Reply with exactly the single word: PONG",
  permissionMode: "bypass",
  waitMs: 180000,
});
const sid = (() => {
  try {
    return JSON.parse(run.text).session_id as string;
  } catch {
    return "";
  }
})();
console.log("\nparsed session_id:", sid || "(none)");

if (sid) {
  await call("glorp_get_session", { id: sid });
  await call("glorp_list_agents", { id: sid });
  await call("glorp_abort_session", { id: sid });
  await call("glorp_destroy_session", { id: sid, cleanupWorkspace: true });
}

await client.close();
await server.close();
console.log("\nSTDIO TOOL AUDIT DONE");
