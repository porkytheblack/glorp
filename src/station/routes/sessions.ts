/** Session lifecycle + messaging route handlers. */

import type { SessionManager } from "../manager.ts";
import { SessionExistsError, WorkspaceError } from "../manager.ts";
import type { StationConfig } from "../config.ts";
import type { CreateSessionInput } from "../types.ts";
import { json, errorJson, noContent, readJson } from "../respond.ts";
import { handleSendMessage } from "../../server/message-endpoint.ts";
import type { SendMessageRequest } from "../../protocol/rest.ts";

export interface SessionRoutes {
  create(req: Request): Promise<Response>;
  list(): Promise<Response>;
  get(id: string): Promise<Response>;
  destroy(id: string, req: Request): Promise<Response>;
  sendMessage(id: string, req: Request): Promise<Response>;
}

/**
 * The session-events WebSocket URL for a session id, on the stable `/api/v1`
 * path (also reachable at the legacy `/sessions/:id/events`). Clients on another
 * host should swap `config.hostname` for the address they dialed.
 */
export function sessionWsUrl(config: StationConfig, id: string): string {
  return `ws://${config.hostname}:${config.port}/api/v1/sessions/${id}/events`;
}

/**
 * Create a session and return its DTO (+ws_url), mapping the known failure
 * modes to status codes. Shared by `POST /sessions` and
 * `POST /workspaces/:id/sessions`.
 */
export async function createSessionResponse(
  manager: SessionManager,
  config: StationConfig,
  body: CreateSessionInput,
): Promise<Response> {
  try {
    const session = await manager.create(body);
    return json({ ...session.toDto(), ws_url: sessionWsUrl(config, session.id) }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof SessionExistsError) return errorJson("session_exists", msg, 409);
    if (err instanceof WorkspaceError) return errorJson("workspace_error", msg, 400);
    return errorJson("session_create_failed", msg, 500);
  }
}

export function sessionRoutes(manager: SessionManager, config: StationConfig): SessionRoutes {
  function wsUrl(id: string): string {
    return sessionWsUrl(config, id);
  }

  return {
    async create(req): Promise<Response> {
      let body: CreateSessionInput;
      try {
        body = await readJson<CreateSessionInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      return createSessionResponse(manager, config, body);
    },

    async list(): Promise<Response> {
      const sessions = await manager.list();
      return json({ sessions, total: sessions.length });
    },

    async get(id): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      return json({ ...session.toDto(), ws_url: wsUrl(id) });
    },

    async destroy(id, req): Promise<Response> {
      const cleanupWorkspace = new URL(req.url).searchParams.get("workspace") === "true";
      const existed = await manager.destroy(id, { workspace: cleanupWorkspace });
      if (!existed) return errorJson("not_found", `Session ${id} not found`, 404);
      return noContent();
    },

    async sendMessage(id, req): Promise<Response> {
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      let body: SendMessageRequest & { wait?: boolean };
      try {
        body = await readJson<SendMessageRequest & { wait?: boolean }>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (!body.text) return errorJson("bad_request", "Missing 'text'", 400);

      // Synchronous mode for CI/automation: collect the full turn and return it.
      if (body.wait) {
        try {
          const handle = await session.ensureBuilt();
          const result = await handleSendMessage(handle, session.bridge, body);
          return json(result, result.error && !result.text ? 502 : 200);
        } catch (err) {
          session.fail(err);
          return errorJson("message_failed", err instanceof Error ? err.message : String(err), 500);
        }
      }

      // Default: fire-and-forget. The client watches the WebSocket event stream.
      void session.send(body.text, body.images);
      return json({ accepted: true, session_id: id }, 202);
    },
  };
}
