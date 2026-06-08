/**
 * Build the Glorp MCP server: an McpServer with every tool group registered
 * against a Glorp client context. Transport-agnostic — index.ts connects it to
 * stdio or streamable HTTP. Cheap to build, so the HTTP transport makes a fresh
 * one per request in stateless mode.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNamespaceTools } from "./tools/namespaces.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerAgentTools } from "./tools/agents.js";
import type { McpContext } from "./client.js";

export const SERVER_INFO = { name: "glorp-mcp", version: "0.1.0" } as const;

export function buildServer(ctx: McpContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Drive a Glorp Garage: provision tenant namespaces, run coding agents in sandboxes, " +
      "and manage the multi-agent roster. Admin tools require an admin key; tenant keys are " +
      "auto-scoped to their namespace. Pass `namespace` to act inside a tenant with an admin key.",
  });
  registerNamespaceTools(server, ctx);
  registerWorkspaceTools(server, ctx);
  registerSessionTools(server, ctx);
  registerAgentTools(server, ctx);
  return server;
}
