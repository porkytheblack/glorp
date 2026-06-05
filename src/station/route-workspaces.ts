/**
 * Dispatch for every `/workspaces…` route — list/create, per-workspace sessions,
 * and the workspace-scoped MCP provisioning sub-routes. Extracted from router.ts
 * so each file stays small and all workspace routing lives in one place.
 * Returns null when the path isn't a workspace route, so the caller continues.
 */

import type { RouteGroups } from "./route-groups.ts";
import { errorJson } from "./respond.ts";

const WORKSPACE = /^\/workspaces\/([^/]+)$/;
const WS_SESSIONS = /^\/workspaces\/([^/]+)\/sessions$/;
const WS_MCP = /^\/workspaces\/([^/]+)\/mcp$/;
const WS_MCP_SYNC = /^\/workspaces\/([^/]+)\/mcp\/sync$/;
const WS_MCP_PROVIDER_SYNC = /^\/workspaces\/([^/]+)\/mcp\/([^/]+)\/sync$/;
const WS_MCP_PROVIDER = /^\/workspaces\/([^/]+)\/mcp\/([^/]+)$/;

type Result = Promise<Response> | Response;

export function matchWorkspaceRoute(req: Request, pathname: string, g: RouteGroups): Result | null {
  const m = req.method;

  if (pathname === "/workspaces") {
    if (m === "GET") return g.workspaces.list();
    if (m === "POST") return g.workspaces.create(req);
    return notAllowed();
  }

  const sessions = pathname.match(WS_SESSIONS);
  if (sessions) {
    if (m === "GET") return g.workspaces.listSessions(sessions[1]!);
    if (m === "POST") return g.workspaces.createSession(sessions[1]!, req);
    return notAllowed();
  }

  // MCP: order matters — exact /mcp, then /mcp/sync, then /mcp/:p/sync, then /mcp/:p.
  const mcp = pathname.match(WS_MCP);
  if (mcp) {
    if (m === "GET") return g.mcp.list(mcp[1]!);
    if (m === "POST") return g.mcp.add(mcp[1]!, req);
    return notAllowed();
  }
  const mcpSync = pathname.match(WS_MCP_SYNC);
  if (mcpSync) return m === "POST" ? g.mcp.syncAll(mcpSync[1]!) : notAllowed();
  const provSync = pathname.match(WS_MCP_PROVIDER_SYNC);
  if (provSync) return m === "POST" ? g.mcp.syncOne(provSync[1]!, provSync[2]!) : notAllowed();
  const prov = pathname.match(WS_MCP_PROVIDER);
  if (prov) return m === "DELETE" ? g.mcp.remove(prov[1]!, prov[2]!) : notAllowed();

  const one = pathname.match(WORKSPACE);
  if (one) {
    if (m === "GET") return g.workspaces.get(one[1]!);
    if (m === "DELETE") return g.workspaces.destroy(one[1]!, req);
    return notAllowed();
  }

  return null;
}

function notAllowed(): Response {
  return errorJson("method_not_allowed", "Method not allowed", 405);
}
