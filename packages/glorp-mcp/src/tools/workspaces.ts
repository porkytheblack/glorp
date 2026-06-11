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
      description:
        "Create a workspace folder on the Garage host. Omit `path` to mint a managed folder under the " +
        "namespace's workspace root (the usual MCP flow). Pass `template` to provision the folder from a " +
        "named setup recipe (clone repos, install skills, set a system prompt, wire MCP providers) before " +
        "it's registered; fill its declared placeholders via `params` (see glorp_list_templates).",
      inputSchema: {
        path: z.string().optional().describe("Absolute path on the Garage host; omit to mint a managed folder"),
        name: z.string().optional(),
        template: z.string().optional().describe("Name of a setup template to provision the workspace from"),
        params: z.record(z.string()).optional().describe("Values for the template's declared {param:NAME} placeholders"),
        namespace: ns,
      },
    },
    ({ path, name, template, params, namespace }) =>
      guard(() => ctx.clientFor(namespace).workspaces.create(path, name, { template, params })),
  );

  server.registerTool(
    "glorp_list_templates",
    {
      title: "List templates",
      description:
        "List the setup templates available for provisioning a workspace, with their section counts and the " +
        "parameters each declares (name, required, default, secret) so you can fill them for glorp_create_workspace.",
      inputSchema: { namespace: ns },
    },
    ({ namespace }) => guard(() => ctx.clientFor(namespace).templates.list()),
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
