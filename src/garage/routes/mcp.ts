/** Workspace-scoped MCP provisioning routes: install / list / sync / remove providers. */

import type { SessionManager } from "../manager.ts";
import { errorJson, json, noContent, readJson } from "../respond.ts";
import type { McpProviderDto, ProvisionMcpInput } from "../types.ts";
import {
  addProvider,
  listToolsViaMcp,
  readManifest,
  removeProvider,
  syncAll,
  syncProvider,
  type ProviderManifest,
  type ToolLister,
} from "../../mcpgen/index.ts";

export interface McpRoutes {
  add(id: string, req: Request): Promise<Response>;
  list(id: string): Promise<Response>;
  syncAll(id: string): Promise<Response>;
  syncOne(id: string, provider: string): Promise<Response>;
  remove(id: string, provider: string): Promise<Response>;
}

/**
 * `lister` is injectable so tests can drive provisioning without the network;
 * production uses the real MCP `tools/list` introspection.
 */
export function mcpRoutes(manager: SessionManager, lister: ToolLister = listToolsViaMcp): McpRoutes {
  const dirFor = (id: string): string | null => manager.getWorkspace(id)?.path ?? null;

  return {
    async add(id, req): Promise<Response> {
      const dir = dirFor(id);
      if (!dir) return notFound(id);
      let body: ProvisionMcpInput;
      try {
        body = await readJson<ProvisionMcpInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      try {
        return json(await addProvider(dir, body, lister), 201);
      } catch (err) {
        return errorJson("mcp_provision_failed", message(err), 400);
      }
    },

    async list(id): Promise<Response> {
      const dir = dirFor(id);
      if (!dir) return notFound(id);
      const providers = Object.entries(readManifest(dir).providers).map(([name, m]) => providerDto(name, m));
      return json({ providers, total: providers.length });
    },

    async syncAll(id): Promise<Response> {
      const dir = dirFor(id);
      if (!dir) return notFound(id);
      return json({ results: await syncAll(dir, lister) });
    },

    async syncOne(id, provider): Promise<Response> {
      const dir = dirFor(id);
      if (!dir) return notFound(id);
      try {
        return json(await syncProvider(dir, provider, lister));
      } catch (err) {
        return errorJson("mcp_sync_failed", message(err), 400);
      }
    },

    async remove(id, provider): Promise<Response> {
      const dir = dirFor(id);
      if (!dir) return notFound(id);
      removeProvider(dir, provider);
      return noContent();
    },
  };
}

function providerDto(name: string, m: ProviderManifest): McpProviderDto {
  return {
    provider: name,
    url: m.url,
    default_identity: m.defaultIdentity ?? m.identities[0]?.name ?? null,
    identities: m.identities,
    tools: m.tools,
    synced_at: m.syncedAt,
  };
}

function notFound(id: string): Response {
  return errorJson("not_found", `Workspace ${id} not found`, 404);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
