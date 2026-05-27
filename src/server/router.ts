/**
 * REST API route handlers for the Glorp server.
 * All responses use the types from src/protocol/rest.ts.
 */

import type { SessionPool } from "./session-pool.ts";
import { listSessions, deleteSession } from "../agent/sessions.ts";
import { GLORP_VERSION } from "../shared/version.ts";
import type {
  HealthResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
  GetSessionResponse,
  SessionInfoDto,
  ListProfilesResponse,
} from "../protocol/rest.ts";
import type { SessionInfo } from "../agent/sessions.ts";
import type { CredentialsStore } from "../agent/credentials.ts";

export interface RouterConfig {
  workspace: string;
  dataDir: string;
  port: number;
  startedAt: number;
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorJson(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}

function sessionToDto(s: SessionInfo): SessionInfoDto {
  return {
    id: s.id,
    title: s.title,
    first_user_message: s.firstUserMessage,
    agent_message_count: s.agentMessageCount,
    user_message_count: s.userMessageCount,
    total_messages: s.totalMessages,
    task_count: s.taskCount,
    pending_inbox_count: s.pendingInboxCount,
    token_count: s.tokenCount,
    turn_count: s.turnCount,
    last_activity: s.lastActivity.toISOString(),
    workspace: s.workspace,
    project_id: s.projectId,
  };
}

export function createRouter(
  pool: SessionPool,
  config: RouterConfig,
  credentials?: CredentialsStore,
) {
  return {
    health(): Response {
      const body: HealthResponse = {
        status: "ok",
        version: GLORP_VERSION,
        workspace: config.workspace,
        uptime_ms: Date.now() - config.startedAt,
        active_sessions: pool.size,
      };
      return json(body);
    },

    async createSession(req: Request): Promise<Response> {
      let body: CreateSessionRequest = {};
      try {
        const text = await req.text();
        if (text) body = JSON.parse(text) as CreateSessionRequest;
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }

      try {
        const { session, created } = await pool.getOrCreate(body.session_id, {
          provider: body.provider,
          model: body.model,
        });
        const resp: CreateSessionResponse = {
          session_id: session.id,
          created,
          title: session.handle.title,
          workspace: config.workspace,
          ws_url: `ws://127.0.0.1:${config.port}/api/v1/sessions/${session.id}/ws`,
        };
        return json(resp, created ? 201 : 200);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorJson("session_create_failed", msg, 500);
      }
    },

    async listSessions(): Promise<Response> {
      const sessions = await listSessions(config.dataDir, {
        kind: "workspace",
        workspace: config.workspace,
      });
      const body: ListSessionsResponse = {
        sessions: sessions.map(sessionToDto),
        total: sessions.length,
      };
      return json(body);
    },

    async getSession(id: string): Promise<Response> {
      const active = pool.get(id);
      if (active) {
        const body: GetSessionResponse = {
          session: {
            id: active.id,
            title: active.handle.title,
            first_user_message: null,
            agent_message_count: 0,
            user_message_count: 0,
            total_messages: 0,
            task_count: 0,
            pending_inbox_count: 0,
            token_count: 0,
            turn_count: 0,
            last_activity: new Date(active.createdAt).toISOString(),
            workspace: config.workspace,
            project_id: null,
          },
          active: true,
          connected_clients: active.clients.size,
          model_label: active.handle.modelLabel,
        };
        return json(body);
      }

      // Fall back to disk sessions.
      const all = await listSessions(config.dataDir, { kind: "all" });
      const found = all.find((s) => s.id === id);
      if (!found) {
        return errorJson("not_found", `Session ${id} not found`, 404);
      }
      const body: GetSessionResponse = {
        session: sessionToDto(found),
        active: false,
        connected_clients: 0,
        model_label: null,
      };
      return json(body);
    },

    async deleteSession(id: string): Promise<Response> {
      if (pool.get(id)) {
        await pool.shutdown(id);
      }
      await deleteSession(config.dataDir, id);
      return new Response(null, { status: 204 });
    },

    listProfiles(): Response {
      if (!credentials) {
        const body: ListProfilesResponse = {
          profiles: [],
          active_profile_id: null,
        };
        return json(body);
      }
      const profiles = credentials.listProfiles().map((p) => ({
        id: p.id,
        label: p.label,
        provider_id: p.providerId,
        model: p.model,
      }));
      const active = credentials.getActiveProfile();
      const body: ListProfilesResponse = {
        profiles,
        active_profile_id: active?.id ?? null,
      };
      return json(body);
    },
  };
}
