/**
 * REST route dispatch for Station. Matches `METHOD /path` against the spec's
 * surface and delegates to grouped handlers. WebSocket upgrades are handled
 * upstream in server.ts before this runs.
 */

import type { SessionManager } from "./manager.ts";
import type { StationConfig } from "./config.ts";
import type { CredentialsStore } from "../agent/credentials.ts";
import type { TemplateStore } from "./templates/store.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { stateRoutes } from "./routes/state.ts";
import { controlRoutes } from "./routes/control.ts";
import { modelRoutes } from "./routes/models.ts";
import { templateRoutes } from "./routes/templates.ts";
import { credentialRoutes } from "./routes/credentials.ts";
import { keyRoutes } from "./routes/keys.ts";
import { healthRoute } from "./routes/health.ts";
import type { KeyStore } from "./auth/key-store.ts";
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

export interface StationRouter {
  route(req: Request, pathname: string): Promise<Response>;
}

export function createStationRouter(
  manager: SessionManager,
  config: StationConfig,
  credentials: CredentialsStore,
  templates: TemplateStore,
  startedAt: number,
  keyStore: KeyStore,
): StationRouter {
  const sessions = sessionRoutes(manager, config);
  const workspaces = workspaceRoutes(manager, config);
  const state = stateRoutes(manager);
  const control = controlRoutes(manager);
  const models = modelRoutes(credentials);
  const tmpl = templateRoutes(templates);
  const creds = credentialRoutes(manager);
  const keys = keyRoutes(keyStore);

  return {
    async route(req, pathname): Promise<Response> {
      const m = req.method;

      if (pathname === "/health" && m === "GET") return healthRoute(manager, startedAt);

      if (pathname === "/keys" && m === "POST") return keys.create(req);
      if (pathname === "/keys" && m === "GET") return keys.list();
      const keyDel = pathname.match(KEY_ID);
      if (keyDel && m === "DELETE") return keys.revoke(keyDel[1]!);

      if (pathname === "/models/catalog" && m === "GET") return models.catalog();
      if (pathname === "/models/providers" && m === "GET") return models.providers();
      if (pathname === "/models/providers" && m === "POST") return models.addProvider(req);
      if (pathname === "/models/profiles" && m === "GET") return models.profiles();
      if (pathname === "/models/profiles" && m === "POST") return models.addProfile(req);
      const act = pathname.match(ACTIVATE);
      if (act && m === "POST") return models.activate(act[1]!);
      const provDel = pathname.match(MODEL_PROVIDER);
      if (provDel && m === "DELETE") return models.deleteProvider(provDel[1]!);
      const profDel = pathname.match(MODEL_PROFILE);
      if (profDel && m === "DELETE") return models.deleteProfile(profDel[1]!);

      if (pathname === "/templates" && m === "GET") return tmpl.list();
      const tm = pathname.match(TEMPLATE);
      if (tm && m === "GET") return tmpl.get(tm[1]!);

      if (pathname === "/workspaces") {
        if (m === "GET") return workspaces.list();
        if (m === "POST") return workspaces.create(req);
        return methodNotAllowed();
      }
      const wsSub = pathname.match(WORKSPACE_SESSIONS);
      if (wsSub) {
        if (m === "GET") return workspaces.listSessions(wsSub[1]!);
        if (m === "POST") return workspaces.createSession(wsSub[1]!, req);
        return methodNotAllowed();
      }
      const wsMatch = pathname.match(WORKSPACE);
      if (wsMatch) {
        const id = wsMatch[1]!;
        if (m === "GET") return workspaces.get(id);
        if (m === "DELETE") return workspaces.destroy(id, req);
        return methodNotAllowed();
      }

      if (pathname === "/sessions") {
        if (m === "POST") return sessions.create(req);
        if (m === "GET") return sessions.list();
        return methodNotAllowed();
      }

      const sub = pathname.match(SUBPATH);
      if (sub) return routeSubpath(req, sub, { sessions, state, control, creds });

      const sess = pathname.match(SESSION);
      if (sess) {
        const id = sess[1]!;
        if (m === "GET") return sessions.get(id);
        if (m === "DELETE") return sessions.destroy(id, req);
        return methodNotAllowed();
      }

      return errorJson("not_found", `No route: ${m} ${pathname}`, 404);
    },
  };
}

type SubGroups = {
  sessions: ReturnType<typeof sessionRoutes>;
  state: ReturnType<typeof stateRoutes>;
  control: ReturnType<typeof controlRoutes>;
  creds: ReturnType<typeof credentialRoutes>;
};

/** Dispatch `/sessions/:id/<resource>[/<rest>]`. */
function routeSubpath(req: Request, m: RegExpMatchArray, g: SubGroups): Promise<Response> | Response {
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
  }
  return methodNotAllowed();
}

function methodNotAllowed(): Response {
  return errorJson("method_not_allowed", "Method not allowed", 405);
}
