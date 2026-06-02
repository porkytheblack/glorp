/**
 * Admin control-plane for tenant namespaces. Lets an external orchestrator
 * provision/deprovision isolated namespaces and mint namespace-bound API keys.
 * Admin-scope enforcement happens upstream in server.ts (same as `/keys`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { NamespaceStore } from "../namespace-store.ts";
import { NamespaceError } from "../namespace-store.ts";
import type { NamespaceRegistry } from "../namespace-registry.ts";
import type { KeyStore } from "../auth/key-store.ts";
import type { StationConfig } from "../config.ts";
import type { Namespace, NamespaceDto, CreateNamespaceInput, CreateNamespaceKeyInput } from "../types.ts";
import { json, errorJson, readJson } from "../respond.ts";

export interface NamespaceControlRoutes {
  create(req: Request): Promise<Response>;
  list(): Response;
  get(id: string): Promise<Response>;
  destroy(id: string, req: Request): Promise<Response>;
  createKey(id: string, req: Request): Promise<Response>;
  listKeys(id: string): Promise<Response>;
}

function toDto(store: NamespaceStore, ns: Namespace, sessionCount?: number): NamespaceDto {
  return {
    id: ns.id,
    name: ns.name,
    slug: ns.slug,
    created_at: ns.createdAt,
    is_default: store.isDefault(ns.id),
    ...(sessionCount !== undefined ? { session_count: sessionCount } : {}),
  };
}

/** rm a path only when it resolves strictly UNDER `root` (never the root itself). */
function removeUnder(target: string, root: string): boolean {
  const dir = path.resolve(target);
  const base = path.resolve(root);
  if (dir === base || !dir.startsWith(base + path.sep)) {
    console.warn(`[glorp-station] refusing to remove ${dir}: not strictly under ${base}`);
    return false;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function namespaceControlRoutes(
  store: NamespaceStore,
  registry: NamespaceRegistry,
  keyStore: KeyStore,
  config: StationConfig,
): NamespaceControlRoutes {
  return {
    async create(req): Promise<Response> {
      let body: CreateNamespaceInput;
      try {
        body = await readJson<CreateNamespaceInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      try {
        const ns = store.create(body);
        return json(toDto(store, ns, 0), 201);
      } catch (err) {
        if (err instanceof NamespaceError) return errorJson("namespace_error", err.message, 400);
        throw err;
      }
    },

    list(): Response {
      const namespaces = store.list().map((ns) => toDto(store, ns));
      return json({ namespaces, total: namespaces.length });
    },

    async get(id): Promise<Response> {
      const ns = store.get(id);
      if (!ns) return notFound(id);
      const sessions = await registry.resolve(id).manager.list();
      return json(toDto(store, ns, sessions.length));
    },

    async destroy(id, req): Promise<Response> {
      if (store.isDefault(id)) return errorJson("cannot_delete_default", "The default namespace cannot be deleted", 400);
      const ns = store.get(id);
      if (!ns) return notFound(id);
      const removeData = new URL(req.url).searchParams.get("data") === "true";

      // Tombstone the id so a concurrent request can't resurrect the bundle (and
      // re-create the subtree) across our await boundaries. Held until the record
      // is gone; resolve() throws NamespaceNotFound for `id` the whole time.
      registry.beginDelete(id);
      try {
        // Revoke every key bound to this namespace so it can't outlive the tenant.
        for (const k of await keyStore.list()) {
          if (k.namespace === id) await keyStore.revoke(k.id);
        }
        // Flush + destroy any live sessions, then forget the bundle.
        const bundle = registry.evict(id);
        if (bundle) await bundle.manager.shutdownAll();

        let dataRemoved = false;
        if (removeData) {
          const a = removeUnder(ns.dataDir, config.dataDir);
          const b = removeUnder(ns.workspaceRoot, config.workspaceRoot);
          dataRemoved = a || b;
        }
        store.delete(id);
        registry.evict(id); // drop anything a racing request may have re-cached
        return json({ deleted: true, data_removed: dataRemoved });
      } finally {
        registry.endDelete(id);
      }
    },

    async createKey(id, req): Promise<Response> {
      if (!store.get(id)) return notFound(id);
      let body: CreateNamespaceKeyInput;
      try {
        body = await readJson<CreateNamespaceKeyInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (!body.name || !body.name.trim()) return errorJson("bad_request", "Missing 'name'", 400);
      const scopes = body.scopes?.length ? body.scopes : ["run", "read"];
      if (scopes.includes("admin")) {
        return errorJson("bad_request", "A namespace key cannot have the 'admin' scope", 400);
      }
      const { key, record } = await keyStore.create(body.name.trim(), scopes, { namespace: id });
      return json(
        {
          data: {
            id: record.id,
            name: record.name,
            key,
            keyPrefix: record.keyPrefix,
            scopes: record.scopes,
            namespace: id,
            createdAt: record.createdAt,
          },
        },
        201,
      );
    },

    async listKeys(id): Promise<Response> {
      if (!store.get(id)) return notFound(id);
      const keys = (await keyStore.list()).filter((k) => k.namespace === id);
      return json({ data: keys });
    },
  };
}

function notFound(id: string): Response {
  return errorJson("not_found", `Namespace ${id} not found`, 404);
}
