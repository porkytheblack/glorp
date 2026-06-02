/**
 * REST route dispatch for Station. Global admin routes (`keys`, `namespaces`)
 * and `templates` are wired once here; the per-namespace data-plane routes
 * (sessions, workspaces, models, state, control, credentials, files) come from
 * the request's already-resolved NamespaceBundle, so a request only ever touches
 * its own namespace's data. Health + WebSocket upgrades are handled in server.ts.
 */

import { templateRoutes } from "./routes/templates.ts";
import { keyRoutes } from "./routes/keys.ts";
import type { KeyStore } from "./auth/key-store.ts";
import type { TemplateStore } from "./templates/store.ts";
import type { NamespaceControlRoutes } from "./routes/namespaces.ts";
import type { NamespaceBundle } from "./namespace-registry.ts";
import type { RouteGroups } from "./route-groups.ts";
import { errorJson } from "./respond.ts";

const KEY_ID = /^\/keys\/([^/]+)$/;
const SESSION = /^\/sessions\/([^/]+)$/;
const SUBPATH = /^\/sessions\/([^/]+)\/([^/]+)(?:\/(.+))?$/;
const ACTIVATE = /^\/models\/profiles\/([^/]+)\/activate$/;
const MODEL_PROVIDER = /^\/models\/providers\/([^/]+)$/;
const MODEL_PROFILE = /^\/models\/profiles\/([^/]+)$/;
const TEMPLATE = /^\/templates\/([^/]+)$/;
const WORKSPACE = /^\/workspaces\/([^/]+)$/;
const WORKSPACE_SESSIONS = /^\/workspaces\/([^/]+)\/sessions$/;
const NAMESPACE = /^\/namespaces\/([^/]+)$/;
const NAMESPACE_KEYS = /^\/namespaces\/([^/]+)\/keys$/;

export interface StationRouter {
  route(req: Request, pathname: string, bundle: NamespaceBundle): Promise<Response>;
}

export function createStationRouter(
  templates: TemplateStore,
  keyStore: KeyStore,
  namespaceCtl: NamespaceControlRoutes,
): StationRouter {
  const tmpl = templateRoutes(templates);
  const keys = keyRoutes(keyStore);

  return {
    async route(req, pathname, bundle): Promise<Response> {
      const m = req.method;
      const g = bundle.routes;

      // --- API keys (admin scope, gated upstream) ---
      if (pathname === "/keys" && m === "POST") return keys.create(req);
      if (pathname === "/keys" && m === "GET") return keys.list();
      const keyDel = pathname.match(KEY_ID);
      if (keyDel && m === "DELETE") return keys.revoke(keyDel[1]!);

      // --- Namespaces (admin scope, gated upstream) ---
      if (pathname === "/namespaces") {
        if (m === "POST") return namespaceCtl.create(req);
        if (m === "GET") return namespaceCtl.list();
        return methodNotAllowed();
      }
      const nsKeys = pathname.match(NAMESPACE_KEYS);
      if (nsKeys) {
        if (m === "POST") return namespaceCtl.createKey(nsKeys[1]!, req);
        if (m === "GET") return namespaceCtl.listKeys(nsKeys[1]!);
        return methodNotAllowed();
      }
      const nsOne = pathname.match(NAMESPACE);
      if (nsOne) {
        if (m === "GET") return namespaceCtl.get(nsOne[1]!);
        if (m === "DELETE") return namespaceCtl.destroy(nsOne[1]!, req);
        return methodNotAllowed();
      }

      // --- Models (per-namespace) ---
      if (pathname === "/models/catalog" && m === "GET") return g.models.catalog();
      if (pathname === "/models/providers" && m === "GET") return g.models.providers();
      if (pathname === "/models/providers" && m === "POST") return g.models.addProvider(req);
      if (pathname === "/models/profiles" && m === "GET") return g.models.profiles();
      if (pathname === "/models/profiles" && m === "POST") return g.models.addProfile(req);
      const act = pathname.match(ACTIVATE);
      if (act && m === "POST") return g.models.activate(act[1]!);
      const provDel = pathname.match(MODEL_PROVIDER);
      if (provDel && m === "DELETE") return g.models.deleteProvider(provDel[1]!);
      const profDel = pathname.match(MODEL_PROFILE);
      if (profDel && m === "DELETE") return g.models.deleteProfile(profDel[1]!);

      // --- Templates (global) ---
      if (pathname === "/templates" && m === "GET") return tmpl.list();
      const tm = pathname.match(TEMPLATE);
      if (tm && m === "GET") return tmpl.get(tm[1]!);

      // --- Workspaces (per-namespace) ---
      if (pathname === "/workspaces") {
        if (m === "GET") return g.workspaces.list();
        if (m === "POST") return g.workspaces.create(req);
        return methodNotAllowed();
      }
      const wsSub = pathname.match(WORKSPACE_SESSIONS);
      if (wsSub) {
        if (m === "GET") return g.workspaces.listSessions(wsSub[1]!);
        if (m === "POST") return g.workspaces.createSession(wsSub[1]!, req);
        return methodNotAllowed();
      }
      const wsMatch = pathname.match(WORKSPACE);
      if (wsMatch) {
        const id = wsMatch[1]!;
        if (m === "GET") return g.workspaces.get(id);
        if (m === "DELETE") return g.workspaces.destroy(id, req);
        return methodNotAllowed();
      }

      // --- Sessions (per-namespace) ---
      if (pathname === "/sessions") {
        if (m === "POST") return g.sessions.create(req);
        if (m === "GET") return g.sessions.list();
        return methodNotAllowed();
      }

      const sub = pathname.match(SUBPATH);
      if (sub) return routeSubpath(req, sub, g);

      const sess = pathname.match(SESSION);
      if (sess) {
        const id = sess[1]!;
        if (m === "GET") return g.sessions.get(id);
        if (m === "DELETE") return g.sessions.destroy(id, req);
        return methodNotAllowed();
      }

      return errorJson("not_found", `No route: ${m} ${pathname}`, 404);
    },
  };
}

/** Dispatch `/sessions/:id/<resource>[/<rest>]` against the namespace's groups. */
function routeSubpath(req: Request, m: RegExpMatchArray, g: RouteGroups): Promise<Response> | Response {
  const [, id, resource, rest] = m as unknown as [string, string, string, string | undefined];
  const method = req.method;

  switch (resource) {
    case "messages":
      if (method === "POST") return g.sessions.sendMessage(id, req);
      break;
    case "abort":
      if (method === "POST") return g.control.abort(id);
      break;
    case "permission-mode":
      if (method === "POST") return g.control.setPermissionMode(id, req);
      break;
    case "profile":
      if (method === "POST") return g.control.setProfile(id, req);
      break;
    case "history":
      if (method === "GET") return g.state.history(id);
      break;
    case "result":
      if (method === "GET") return g.state.result(id);
      break;
    case "plan":
      if (method === "GET") return g.state.plan(id);
      break;
    case "tasks":
      if (method === "GET") return g.state.tasks(id);
      break;
    case "agents":
      if (method === "GET" && !rest) return g.state.agents(id);
      if (method === "POST" && !rest) return g.control.addAgent(id, req);
      if (method === "POST" && rest) return g.control.switchAgent(id, rest);
      if (method === "DELETE" && rest) return g.control.removeAgent(id, rest);
      break;
    case "slots":
      if (method === "POST") {
        return rest ? g.control.resolveSlot(id, rest, req) : errorJson("bad_request", "Missing slot id", 400);
      }
      break;
    case "permissions":
      if (method === "GET" && !rest) return g.state.permissions(id);
      if (method === "DELETE" && rest) return g.state.revokePermission(id, rest);
      break;
    case "credentials":
      if (method === "POST") return g.creds.set(id, req);
      if (method === "DELETE") return g.creds.clear(id);
      break;
    case "files":
      if (method === "GET" && !rest) return g.files.list(id);
      if (method === "POST" && !rest) return g.files.upload(id, req);
      if (method === "GET" && rest) return g.files.download(id, rest);
      if (method === "DELETE" && rest) return g.files.remove(id, rest);
      break;
  }
  return methodNotAllowed();
}

function methodNotAllowed(): Response {
  return errorJson("method_not_allowed", "Method not allowed", 405);
}
