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
import { stateRoutes } from "./routes/state.ts";
import { controlRoutes } from "./routes/control.ts";
import { modelRoutes } from "./routes/models.ts";
import { templateRoutes } from "./routes/templates.ts";
import { credentialRoutes } from "./routes/credentials.ts";
import { healthRoute } from "./routes/health.ts";
import { errorJson } from "./respond.ts";

const SESSION = /^\/sessions\/([^/]+)$/;
const SUBPATH = /^\/sessions\/([^/]+)\/([^/]+)(?:\/(.+))?$/;
const ACTIVATE = /^\/models\/profiles\/([^/]+)\/activate$/;
const TEMPLATE = /^\/templates\/([^/]+)$/;

export interface StationRouter {
  route(req: Request, pathname: string): Promise<Response>;
}

export function createStationRouter(
  manager: SessionManager,
  config: StationConfig,
  credentials: CredentialsStore,
  templates: TemplateStore,
  startedAt: number,
): StationRouter {
  const sessions = sessionRoutes(manager, config);
  const state = stateRoutes(manager);
  const control = controlRoutes(manager);
  const models = modelRoutes(credentials);
  const tmpl = templateRoutes(templates);
  const creds = credentialRoutes(manager);

  return {
    async route(req, pathname): Promise<Response> {
      const m = req.method;

      if (pathname === "/health" && m === "GET") return healthRoute(manager, startedAt);

      if (pathname === "/models/providers" && m === "GET") return models.providers();
      if (pathname === "/models/profiles" && m === "GET") return models.profiles();
      const act = pathname.match(ACTIVATE);
      if (act && m === "POST") return models.activate(act[1]!);

      if (pathname === "/templates" && m === "GET") return tmpl.list();
      const tm = pathname.match(TEMPLATE);
      if (tm && m === "GET") return tmpl.get(tm[1]!);

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
    case "history":
      if (method === "GET") return g.state.history(id);
      break;
    case "plan":
      if (method === "GET") return g.state.plan(id);
      break;
    case "tasks":
      if (method === "GET") return g.state.tasks(id);
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
