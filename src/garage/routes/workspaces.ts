/** First-class workspace routes: register folders, list/create their sessions. */

import type { SessionManager } from "../manager.ts";
import { WorkspaceError } from "../manager.ts";
import type { GarageConfig } from "../config.ts";
import type { CreateWorkspaceInput, CreateSessionInput } from "../types.ts";
import { json, errorJson, noContent, readJson } from "../respond.ts";
import { createSessionResponse } from "./sessions.ts";

export interface WorkspaceRoutes {
  list(): Promise<Response>;
  create(req: Request): Promise<Response>;
  get(id: string): Promise<Response>;
  destroy(id: string, req: Request): Promise<Response>;
  listSessions(id: string): Promise<Response>;
  createSession(id: string, req: Request): Promise<Response>;
}

export function workspaceRoutes(manager: SessionManager, config: GarageConfig): WorkspaceRoutes {
  return {
    async list(): Promise<Response> {
      const workspaces = await manager.listWorkspaces();
      return json({ workspaces, total: workspaces.length });
    },

    async create(req): Promise<Response> {
      let body: CreateWorkspaceInput;
      try {
        body = await readJson<CreateWorkspaceInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      try {
        return json(manager.createWorkspace(body), 201);
      } catch (err) {
        if (err instanceof WorkspaceError) return errorJson("workspace_error", err.message, 400);
        const msg = err instanceof Error ? err.message : String(err);
        return errorJson("workspace_create_failed", msg, 500);
      }
    },

    async get(id): Promise<Response> {
      const ws = manager.getWorkspace(id);
      if (!ws) return notFound(id);
      const sessions = await manager.sessionsForWorkspace(id);
      return json({
        id: ws.id,
        name: ws.name,
        path: ws.path,
        created_at: ws.createdAt,
        session_count: sessions.length,
        sessions,
      });
    },

    async destroy(id, req): Promise<Response> {
      const cascade = new URL(req.url).searchParams.get("sessions") === "true";
      const existed = await manager.deleteWorkspace(id, { sessions: cascade });
      if (!existed) return notFound(id);
      return noContent();
    },

    async listSessions(id): Promise<Response> {
      if (!manager.getWorkspace(id)) return notFound(id);
      const sessions = await manager.sessionsForWorkspace(id);
      return json({ sessions, total: sessions.length });
    },

    async createSession(id, req): Promise<Response> {
      if (!manager.getWorkspace(id)) return notFound(id);
      let body: CreateSessionInput;
      try {
        body = await readJson<CreateSessionInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      return createSessionResponse(manager, config, { ...body, workspaceId: id });
    },
  };
}

function notFound(id: string): Response {
  return errorJson("not_found", `Workspace ${id} not found`, 404);
}
