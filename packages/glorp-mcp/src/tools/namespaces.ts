/** Namespace orchestration tools (admin key required server-side). */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../client.js";
import { guard } from "./util.js";

export function registerNamespaceTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "glorp_list_namespaces",
    {
      title: "List namespaces",
      description: "List all tenant namespaces (admin). Always includes the built-in `default`.",
      inputSchema: {},
    },
    () => guard(() => ctx.base.namespaces.list()),
  );

  server.registerTool(
    "glorp_get_namespace",
    {
      title: "Get namespace",
      description: "Fetch one namespace and its session count (admin).",
      inputSchema: { id: z.string().describe("Namespace id, e.g. ns_acme") },
    },
    ({ id }) => guard(() => ctx.base.namespaces.get(id)),
  );

  server.registerTool(
    "glorp_create_namespace",
    {
      title: "Create namespace",
      description: "Provision a new isolated tenant namespace (admin). Returns its id (ns_<slug>).",
      inputSchema: {
        name: z.string().describe("Human name; the slug/id is derived from it"),
        slug: z.string().optional().describe("Optional explicit slug"),
      },
    },
    ({ name, slug }) => guard(() => ctx.base.namespaces.create(name, slug)),
  );

  server.registerTool(
    "glorp_delete_namespace",
    {
      title: "Delete namespace",
      description:
        "Deprovision a namespace (admin): revokes its keys and stops its sessions. `removeData` also wipes its data subtree + sandboxes. The `default` namespace cannot be deleted.",
      inputSchema: {
        id: z.string(),
        removeData: z.boolean().optional().describe("Also delete on-disk data + sandboxes (default false)"),
      },
    },
    ({ id, removeData }) => guard(() => ctx.base.namespaces.delete(id, removeData ?? false)),
  );

  server.registerTool(
    "glorp_mint_namespace_key",
    {
      title: "Mint namespace key",
      description:
        "Create an API key bound to a namespace (admin). The raw key is returned ONCE. The `admin` scope is rejected for namespace keys.",
      inputSchema: {
        id: z.string().describe("Namespace id to bind the key to"),
        name: z.string().describe("A label for the key"),
        scopes: z.array(z.string()).optional().describe("Defaults to [run, read]"),
      },
    },
    ({ id, name, scopes }) => guard(() => ctx.base.namespaces.createKey(id, name, scopes)),
  );

  server.registerTool(
    "glorp_list_namespace_keys",
    {
      title: "List namespace keys",
      description: "List the API keys bound to a namespace (admin; never returns the raw key).",
      inputSchema: { id: z.string() },
    },
    ({ id }) => guard(() => ctx.base.namespaces.listKeys(id)),
  );
}
