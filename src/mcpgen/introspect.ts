import { bearer, connectMcp } from "glove-mcp";
import type { ToolDef } from "./types.ts";

/**
 * Connect to an MCP server and list its tools. This is the only piece that
 * talks to the live server, and it runs only at provision/sync time — never
 * when the generated workspace executes a tool.
 */
export async function listToolsViaMcp(url: string, token: string, provider: string): Promise<ToolDef[]> {
  const conn = await connectMcp({
    namespace: provider,
    url,
    auth: bearer(token),
    clientInfo: { name: "glorp-mcpgen", version: "1" },
  });
  try {
    const tools = await conn.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  } finally {
    await conn.close();
  }
}
