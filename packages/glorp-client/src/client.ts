/**
 * `createClient({ endpoint, apiKey })` — a typed client over the Station REST/WS
 * API, grouped into `workspaces`, `sessions`, `models`, `keys`, plus the
 * headline `run()` and `streamSession()`. Pass no opts to use the config from
 * `configure()` / env.
 */

import { request, ping, requestForm, requestBinary } from "./rest.js";
import { runWith, type RunHandle, type RunOptions } from "./run.js";
import { streamSessionWith, type SessionStream } from "./ws.js";
import { resolveConfig, type GlorpConfig } from "./config.js";
import type {
  AgentInfo,
  ApiKeyPublic,
  BridgeEvent,
  CreateSessionInput,
  FileListResponse,
  PermissionGrant,
  SessionDto,
  SessionResult,
  WorkspaceDto,
} from "./contract.js";

/** Encode a workspace-relative path for a URL, keeping `/` separators. */
function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

type Roster = { agents: AgentInfo[]; active_agent_id: string };

export function createClient(opts?: GlorpConfig) {
  const cfg = resolveConfig(opts);
  const req = <T>(method: string, path: string, body?: unknown) => request<T>(cfg, method, path, body);

  return {
    config: cfg,
    ping: () => ping(cfg),

    workspaces: {
      list: () => req<{ workspaces: WorkspaceDto[]; total: number }>("GET", "/workspaces"),
      create: (path: string, name?: string) => req<WorkspaceDto>("POST", "/workspaces", { path, name }),
      get: (id: string) => req<WorkspaceDto & { sessions: SessionDto[] }>("GET", `/workspaces/${id}`),
      delete: (id: string, cascadeSessions = false) =>
        req<void>("DELETE", `/workspaces/${id}${cascadeSessions ? "?sessions=true" : ""}`),
    },

    sessions: {
      create: (body: CreateSessionInput = {}) => req<SessionDto>("POST", "/sessions", body),
      createInWorkspace: (id: string, body: CreateSessionInput = {}) =>
        req<SessionDto>("POST", `/workspaces/${id}/sessions`, body),
      list: () => req<{ sessions: SessionDto[]; total: number }>("GET", "/sessions"),
      get: (id: string) => req<SessionDto>("GET", `/sessions/${id}`),
      destroy: (id: string, cleanupWorkspace = false) =>
        req<void>("DELETE", `/sessions/${id}${cleanupWorkspace ? "?workspace=true" : ""}`),
      sendMessage: (id: string, text: string) =>
        req<{ accepted: boolean }>("POST", `/sessions/${id}/messages`, { text }),
      /** Blocking variant: runs the turn and returns its final text. */
      sendMessageAndWait: (id: string, text: string) =>
        req<{ text?: string; error?: string }>("POST", `/sessions/${id}/messages`, { text, wait: true }),
      abort: (id: string) => req<{ aborted: boolean }>("POST", `/sessions/${id}/abort`),
      setPermissionMode: (id: string, mode: string) =>
        req<unknown>("POST", `/sessions/${id}/permission-mode`, { mode }),
      setProfile: (id: string, profileId: string) =>
        req<unknown>("POST", `/sessions/${id}/profile`, { profile_id: profileId }),
      history: (id: string) => req<{ turns: unknown[] }>("GET", `/sessions/${id}/history`),
      result: (id: string) => req<SessionResult>("GET", `/sessions/${id}/result`),
      plan: (id: string) => req<{ plan: unknown }>("GET", `/sessions/${id}/plan`),
      tasks: (id: string) => req<{ tasks: unknown[] }>("GET", `/sessions/${id}/tasks`),

      // Multi-agent roster (subagents).
      agents: (id: string) => req<Roster>("GET", `/sessions/${id}/agents`),
      addAgent: (id: string, role: string, label?: string) =>
        req<Roster & { agent_id: string }>("POST", `/sessions/${id}/agents`, { role, label }),
      switchAgent: (id: string, agentId: string) =>
        req<Roster>("POST", `/sessions/${id}/agents/${agentId}`, {}),
      removeAgent: (id: string, agentId: string) =>
        req<Roster>("DELETE", `/sessions/${id}/agents/${agentId}`),

      // Tool-permission grants.
      permissions: (id: string) => req<{ permissions: PermissionGrant[] }>("GET", `/sessions/${id}/permissions`),
      revokePermission: (id: string, key: string) =>
        req<void>("DELETE", `/sessions/${id}/permissions/${encodeURIComponent(key)}`),

      // File exchange — the session's `uploads/` folder (shared with the agent).
      files: (id: string) => req<FileListResponse>("GET", `/sessions/${id}/files`),
      uploadFile: (id: string, file: Blob, name: string) => {
        const form = new FormData();
        form.append("file", file, name);
        return requestForm<FileListResponse>(cfg, `/sessions/${id}/files`, form);
      },
      downloadFile: (id: string, p: string) =>
        requestBinary(cfg, "GET", `/sessions/${id}/files/${encodePath(p)}`),
      deleteFile: (id: string, p: string) =>
        req<void>("DELETE", `/sessions/${id}/files/${encodePath(p)}`),
    },

    models: {
      providers: () => req<unknown>("GET", "/models/providers"),
      profiles: () => req<unknown>("GET", "/models/profiles"),
      catalog: () => req<unknown>("GET", "/models/catalog"),
    },

    keys: {
      create: (name: string, scopes?: string[]) =>
        req<{ id: string; name: string; key: string; keyPrefix: string; scopes: string[] }>("POST", "/keys", { name, scopes }),
      list: () => req<ApiKeyPublic[]>("GET", "/keys"),
      revoke: (id: string) => req<{ revoked: boolean }>("DELETE", `/keys/${id}`),
    },

    run: (o: RunOptions): Promise<RunHandle> => runWith(cfg, o),
    streamSession: (id: string, onEvent?: (event: BridgeEvent) => void): SessionStream =>
      streamSessionWith(cfg, id, onEvent),
  };
}

export type GlorpClient = ReturnType<typeof createClient>;
