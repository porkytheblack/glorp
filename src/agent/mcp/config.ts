/**
 * User-facing MCP server configuration.
 *
 * Servers are declared in the `mcp` section of glorp.json (any layer — see
 * project-config.ts). Each entry describes one streamable-HTTP MCP server;
 * glove-mcp bridges its tools onto the main agent as `<id>__<tool>`.
 *
 *   {
 *     "mcp": {
 *       "linear": {
 *         "url": "https://mcp.linear.app/mcp",
 *         "auth": "{env:LINEAR_MCP_TOKEN}",
 *         "description": "Linear issues and projects",
 *         "tags": ["issues", "projects"]
 *       }
 *     }
 *   }
 */

import type { McpCatalogueEntry } from "glove-mcp";

export interface McpServerConfig {
  /** MCP server URL. HTTP(S) streamable transport only (glove-mcp v1). */
  url: string;
  /** Bearer token. `{env:VAR}` / `{file:PATH}` are interpolated at load. */
  auth?: string;
  /** Display name (defaults to the entry id). */
  name?: string;
  /** Short description — also used by the discovery subagent for matching. */
  description?: string;
  /** Free-form tags used by discovery matching and the TUI filter. */
  tags?: string[];
  /** false ⇒ hidden from the catalogue entirely. Default true. */
  enabled?: boolean;
  /** false ⇒ listed but not connected at session start. Default true. */
  autoConnect?: boolean;
}

export type McpSection = Record<string, McpServerConfig>;

/** Per-server shallow merge of one config layer over a lower-priority base. */
export function mergeMcpSections(base: McpSection | undefined, layer: McpSection): McpSection {
  const out: McpSection = { ...(base ?? {}) };
  for (const [id, server] of Object.entries(layer)) {
    out[id] = { ...(out[id] ?? {}), ...server };
  }
  return out;
}

/** Catalogue entries for every enabled server with a usable HTTP url. */
export function mcpCatalogue(mcp: McpSection): McpCatalogueEntry[] {
  return Object.entries(mcp)
    .filter(([, s]) => s.enabled !== false && isHttpUrl(s.url))
    .map(([id, s]) => ({
      id,
      name: s.name ?? id,
      description: s.description ?? `MCP server at ${s.url}`,
      url: s.url,
      ...(s.tags?.length ? { tags: s.tags } : {}),
    }));
}

/** Ids connected at session start when no active-set file exists yet. */
export function autoConnectIds(mcp: McpSection): string[] {
  return mcpCatalogue(mcp)
    .filter((e) => mcp[e.id]?.autoConnect !== false)
    .map((e) => e.id);
}

/** Bearer token for a server id, or undefined when the server needs no auth. */
export function mcpToken(mcp: McpSection, id: string): string | undefined {
  const token = mcp[id]?.auth?.trim();
  return token ? token : undefined;
}

function isHttpUrl(url: unknown): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}
