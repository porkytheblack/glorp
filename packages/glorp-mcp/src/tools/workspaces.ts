/** Workspace tools. Each accepts an optional `namespace` (admin proxy). */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../client.js";
import { guard } from "./util.js";

const ns = z.string().optional().describe("Act inside this namespace (admin keys only)");

export function registerWorkspaceTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "glorp_list_workspaces",
    {
      title: "List workspaces",
      description: "List the first-class workspaces (folders) and their session counts.",
      inputSchema: { namespace: ns },
    },
    ({ namespace }) => guard(() => ctx.clientFor(namespace).workspaces.list()),
  );

  server.registerTool(
    "glorp_create_workspace",
    {
      title: "Create workspace",
      description: "Register a workspace folder on the Garage host (tenants are confined to their namespace root).",
      inputSchema: {
        path: z.string().describe("Absolute path on the Garage host"),
        name: z.string().optional(),
        namespace: ns,
      },
    },
    ({ path, name, namespace }) => guard(() => ctx.clientFor(namespace).workspaces.create(path, name)),
  );

  server.registerTool(
    "glorp_delete_workspace",
    {
      title: "Delete workspace",
      description: "Remove a workspace registry entry; `cascadeSessions` also destroys its sessions.",
      inputSchema: {
        id: z.string(),
        cascadeSessions: z.boolean().optional(),
        namespace: ns,
      },
    },
    ({ id, cascadeSessions, namespace }) =>
      guard(() => ctx.clientFor(namespace).workspaces.delete(id, cascadeSessions ?? false)),
  );
}
