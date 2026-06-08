/**
 * API-key management routes (admin scope). Responses use the `{ data }`
 * envelope to match the Garage ecosystem's keys API. The raw key is returned
 * exactly once, on creation. Admin-scope enforcement happens upstream in
 * server.ts (the verified key is checked before routing reaches here).
 */

import type { KeyStore } from "../auth/key-store.ts";
import { json, errorJson, readJson } from "../respond.ts";

export interface KeyRoutes {
  create(req: Request): Promise<Response>;
  list(): Promise<Response>;
  revoke(id: string): Promise<Response>;
}

export function keyRoutes(keyStore: KeyStore): KeyRoutes {
  return {
    async create(req): Promise<Response> {
      let body: { name?: string; scopes?: string[] };
      try {
        body = await readJson<{ name?: string; scopes?: string[] }>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (!body.name || !body.name.trim()) return errorJson("bad_request", "Missing 'name'", 400);
      const { key, record } = await keyStore.create(body.name.trim(), body.scopes);
      return json(
        {
          data: {
            id: record.id,
            name: record.name,
            key,
            keyPrefix: record.keyPrefix,
            scopes: record.scopes,
            createdAt: record.createdAt,
          },
        },
        201,
      );
    },

    async list(): Promise<Response> {
      return json({ data: await keyStore.list() });
    },

    async revoke(id): Promise<Response> {
      const revoked = await keyStore.revoke(id);
      if (!revoked) return errorJson("not_found", `Key ${id} not found`, 404);
      return json({ data: { revoked: true } });
    },
  };
}
