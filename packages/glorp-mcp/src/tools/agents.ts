/** Multi-agent roster tools (subagents within a session). */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../client.js";
import { guard } from "./util.js";

const ns = z.string().optional().describe("Act inside this namespace (admin keys only)");

export function registerAgentTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "glorp_list_agents",
    {
      title: "List agents",
      description: "List the multi-agent roster for a session.",
      inputSchema: { id: z.string(), namespace: ns },
    },
    ({ id, namespace }) => guard(() => ctx.clientFor(namespace).sessions.agents(id)),
  );

  server.registerTool(
    "glorp_add_agent",
    {
      title: "Add agent",
      description: "Add a subagent (by role) to a session's roster.",
      inputSchema: { id: z.string(), role: z.string(), label: z.string().optional(), namespace: ns },
    },
    ({ id, role, label, namespace }) => guard(() => ctx.clientFor(namespace).sessions.addAgent(id, role, label)),
  );

  server.registerTool(
    "glorp_switch_agent",
    {
      title: "Switch active agent",
      description: "Make a roster agent the active one for a session.",
      inputSchema: { id: z.string(), agentId: z.string(), namespace: ns },
    },
    ({ id, agentId, namespace }) => guard(() => ctx.clientFor(namespace).sessions.switchAgent(id, agentId)),
  );

  server.registerTool(
    "glorp_remove_agent",
    {
      title: "Remove agent",
      description: "Remove a subagent from a session's roster.",
      inputSchema: { id: z.string(), agentId: z.string(), namespace: ns },
    },
    ({ id, agentId, namespace }) => guard(() => ctx.clientFor(namespace).sessions.removeAgent(id, agentId)),
  );
}
