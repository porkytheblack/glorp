/**
 * REST route dispatch for Garage. Global admin routes (`keys`, `namespaces`)
 * and `templates` are wired once here; the per-namespace data-plane routes
 * (sessions, workspaces, models, state, control, credentials, files) come from
 * the request's already-resolved NamespaceBundle, so a request only ever touches
 * its own namespace's data. Health + WebSocket upgrades are handled in server.ts.
 */

import { templateRoutes } from "./routes/templates.ts";
import { keyRoutes } from "./routes/keys.ts";
import { storageRoutes } from "./routes/storage.ts";
import type { StorageConfigStore } from "./storage/config-store.ts";
import type { KeyStore } from "./auth/key-store.ts";
import type { TemplateSource } from "./templates/source.ts";
import type { NamespaceControlRoutes } from "./routes/namespaces.ts";
import type { NamespaceBundle } from "./namespace-registry.ts";
import type { RouteGroups } from "./route-groups.ts";
import { matchWorkspaceRoute } from "./route-workspaces.ts";
import { errorJson } from "./respond.ts";

const KEY_ID = /^\/keys\/([^/]+)$/;
const SESSION = /^\/sessions\/([^/]+)$/;
const SUBPATH = /^\/sessions\/([^/]+)\/([^/]+)(?:\/(.+))?$/;
const ACTIVATE = /^\/models\/profiles\/([^/]+)\/activate$/;
const MODEL_PROVIDER = /^\/models\/providers\/([^/]+)$/;
const MODEL_PROVIDER_MODELS = /^\/models\/providers\/([^/]+)\/models$/;
const MODEL_PROFILE = /^\/models\/profiles\/([^/]+)$/;
const MODEL_PROFILE_REASONING = /^\/models\/profiles\/([^/]+)\/reasoning$/;
const TEMPLATE = /^\/templates\/([^/]+)$/;
const NAMESPACE = /^\/namespaces\/([^/]+)$/;
const NAMESPACE_KEYS = /^\/namespaces\/([^/]+)\/keys$/;
const TASK_ID = /^\/tasks\/([^/]+)$/;
const TASK_SUB = /^\/tasks\/([^/]+)\/([^/]+)(?:\/(.+))?$/;

export interface GarageRouter {
  route(req: Request, pathname: string, bundle: NamespaceBundle): Promise<Response>;
}

export function createGarageRouter(
  templates: TemplateSource,
  keyStore: KeyStore,
  namespaceCtl: NamespaceControlRoutes,
  storageConfig?: StorageConfigStore,
): GarageRouter {
  const tmpl = templateRoutes(templates);
  const keys = keyRoutes(keyStore);
  const storage = storageConfig ? storageRoutes(storageConfig) : null;

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
      if (pathname === "/models/reasoning-options" && m === "GET") return g.models.reasoningOptions(req);
      if (pathname === "/models/providers" && m === "GET") return g.models.providers();
      if (pathname === "/models/providers" && m === "POST") return g.models.addProvider(req);
      if (pathname === "/models/profiles" && m === "GET") return g.models.profiles();
      if (pathname === "/models/profiles" && m === "POST") return g.models.addProfile(req);
      const provModels = pathname.match(MODEL_PROVIDER_MODELS);
      if (provModels && m === "GET") return g.models.listProviderModels(provModels[1]!);
      const act = pathname.match(ACTIVATE);
      if (act && m === "POST") return g.models.activate(act[1]!);
      const profReason = pathname.match(MODEL_PROFILE_REASONING);
      if (profReason && m === "POST") return g.models.setReasoning(profReason[1]!, req);
      const provDel = pathname.match(MODEL_PROVIDER);
      if (provDel && m === "DELETE") return g.models.deleteProvider(provDel[1]!);
      const profDel = pathname.match(MODEL_PROFILE);
      if (profDel && m === "DELETE") return g.models.deleteProfile(profDel[1]!);

      // --- Templates (global) ---
      if (pathname === "/templates" && m === "GET") return tmpl.list();
      const tm = pathname.match(TEMPLATE);
      if (tm && m === "GET") return tmpl.get(tm[1]!);

      // --- Remote storage settings (global, admin-gated upstream) ---
      if (storage && pathname === "/storage") {
        if (m === "GET") return storage.get();
        if (m === "PUT") return storage.update(req);
        return methodNotAllowed();
      }

      // --- Workspaces + MCP provisioning (per-namespace) ---
      const ws = matchWorkspaceRoute(req, pathname, g);
      if (ws) return ws;

      // --- Tasks (per-namespace, the simple black-box surface) ---
      const task = matchTaskRoute(req, pathname, g);
      if (task) return task;

      // --- Usage / spend rollup (per-namespace) ---
      if (pathname === "/usage" && m === "GET") return g.usage.namespace();

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
    case "extensions":
      if (method === "GET") return g.state.extensions(id);
      break;
    case "result":
      if (method === "GET") return g.state.result(id);
      break;
    case "usage":
      if (method === "GET" && !rest) return g.usage.session(id);
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
      if (method === "GET" && !rest) return g.state.slots(id);
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
      if (method === "GET" && !rest) return g.files.list(id, req);
      if (method === "POST" && !rest) return g.files.upload(id, req);
      if (method === "GET" && rest) return g.files.download(id, rest);
      if (method === "DELETE" && rest) return g.files.remove(id, rest);
      break;
  }
  return methodNotAllowed();
}

/**
 * Dispatch the `/tasks…` surface. Task id == session id, so the file
 * sub-routes reuse the session files group directly (uploads + R2 for free).
 * Returns null when the path isn't a task route, so the caller falls through.
 */
function matchTaskRoute(req: Request, pathname: string, g: RouteGroups): Promise<Response> | Response | null {
  const m = req.method;
  if (pathname === "/tasks") {
    if (m === "POST") return g.tasks.create(req);
    if (m === "GET") return g.tasks.list();
    return methodNotAllowed();
  }
  const sub = pathname.match(TASK_SUB);
  if (sub) {
    const [, id, resource, rest] = sub as unknown as [string, string, string, string | undefined];
    switch (resource) {
      case "messages":
        if (m === "POST") return g.tasks.messages(id, req);
        break;
      case "start":
        if (m === "POST") return g.tasks.start(id);
        break;
      case "answers":
        if (m === "POST") return g.tasks.answers(id, req);
        break;
      case "files":
        if (m === "GET" && !rest) return g.files.list(id, req);
        if (m === "POST" && !rest) return g.files.upload(id, req);
        if (m === "GET" && rest) return g.files.download(id, rest);
        if (m === "DELETE" && rest) return g.files.remove(id, rest);
        break;
      case "inputs":
        // Caller-supplied input files (the worker's read-side), in `inputs/`.
        if (m === "GET" && !rest) return g.inputs.list(id, req);
        if (m === "POST" && !rest) return g.inputs.upload(id, req);
        if (m === "GET" && rest) return g.inputs.download(id, rest);
        if (m === "DELETE" && rest) return g.inputs.remove(id, rest);
        break;
    }
    return methodNotAllowed();
  }
  const idm = pathname.match(TASK_ID);
  if (idm) {
    const id = idm[1]!;
    // `/tasks/types` is the catalog, not a task id.
    if (id === "types") return m === "GET" ? g.tasks.types() : methodNotAllowed();
    if (m === "GET") return g.tasks.get(id);
    if (m === "DELETE") return g.tasks.destroy(id);
    return methodNotAllowed();
  }
  return null;
}

function methodNotAllowed(): Response {
  return errorJson("method_not_allowed", "Method not allowed", 405);
}
