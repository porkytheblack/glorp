/**
 * Per-session custom credential endpoints. Keys are accepted, held in memory,
 * and applied to the live model — never persisted and never returned.
 */

import type { SessionManager } from "../manager.ts";
import type { SessionCredential } from "../types.ts";
import { json, errorJson, noContent, readJson } from "../respond.ts";

export interface CredentialRoutes {
  set(id: string, req: Request): Promise<Response>;
  clear(id: string): Promise<Response>;
}

export function credentialRoutes(manager: SessionManager): CredentialRoutes {
  return {
    async set(id, req): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      let body: SessionCredential;
      try {
        body = await readJson<SessionCredential>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (!body.provider || !body.apiKey) {
        return errorJson("bad_request", "Both 'provider' and 'apiKey' are required", 400);
      }
      try {
        await session.setCredential(body);
      } catch (err) {
        return errorJson("credential_error", err instanceof Error ? err.message : String(err), 400);
      }
      return json(session.toDto());
    },

    async clear(id): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      try {
        await session.clearCredential();
      } catch (err) {
        return errorJson("credential_error", err instanceof Error ? err.message : String(err), 409);
      }
      return noContent();
    },
  };
}
