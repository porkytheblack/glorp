/**
 * Thin REST client for the Station API. Same-origin in production (the
 * dashboard is served by Station); proxied to Station in dev via vite.config.
 */

import type { SessionDto, WorkspaceDto } from "../types.ts";

export interface CreateSessionBody {
  workspace?: string;
  workspaceId?: string;
  template?: string;
  params?: Record<string, string>;
  provider?: string;
  model?: string;
  profileId?: string;
  permissionMode?: "normal" | "auto" | "bypass";
  credentials?: { provider: string; apiKey: string; model?: string };
}

export interface TemplateSummary {
  name: string;
  description: string | null;
  step_count: number;
}

export interface ProfileSummary {
  id: string;
  label: string;
  provider_id: string;
  model: string;
  last_used_at: string | null;
}

export interface ProviderSummary {
  id: string;
  type: "known" | "custom";
  based_on: string | null;
  adapter: string | null;
  base_url: string | null;
  context_limit: number | null;
  has_api_key: boolean;
}

export interface CatalogProvider {
  id: string;
  label: string;
  description: string;
  env_var: string | null;
  default_models: string[];
  needs_api_key: boolean;
  reasoning_capable: boolean;
}

export interface AgentInfo {
  id: string;
  label: string;
  role: string;
  active: boolean;
  busy: boolean;
  createdAt: number;
  lastActiveAt: number;
  turnCount: number;
}

export interface PermissionGrant {
  key: string;
  status: string;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}${text ? `: ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => req<{ status: string; version: string }>("GET", "/health"),

  listWorkspaces: () => req<{ workspaces: WorkspaceDto[]; total: number }>("GET", "/workspaces"),
  createWorkspace: (path: string, name?: string) =>
    req<WorkspaceDto>("POST", "/workspaces", { path, name }),
  deleteWorkspace: (id: string, cascadeSessions = false) =>
    req<void>("DELETE", `/workspaces/${id}${cascadeSessions ? "?sessions=true" : ""}`),
  workspaceSessions: (id: string) =>
    req<{ sessions: SessionDto[]; total: number }>("GET", `/workspaces/${id}/sessions`),
  createSessionInWorkspace: (id: string, body: CreateSessionBody = {}) =>
    req<SessionDto>("POST", `/workspaces/${id}/sessions`, body),

  listSessions: () => req<{ sessions: SessionDto[]; total: number }>("GET", "/sessions"),
  getSession: (id: string) => req<SessionDto>("GET", `/sessions/${id}`),
  createSession: (body: CreateSessionBody) => req<SessionDto>("POST", "/sessions", body),
  destroySession: (id: string, cleanupWorkspace = false) =>
    req<void>("DELETE", `/sessions/${id}${cleanupWorkspace ? "?workspace=true" : ""}`),

  sendMessage: (id: string, text: string) =>
    req<{ accepted: boolean }>("POST", `/sessions/${id}/messages`, { text }),
  abort: (id: string) => req<{ aborted: boolean }>("POST", `/sessions/${id}/abort`),
  resolveSlot: (id: string, slotId: string, action: "approve" | "deny") =>
    req<unknown>("POST", `/sessions/${id}/slots/${slotId}`, { action }),

  setPermissionMode: (id: string, mode: string) =>
    req<SessionDto>("POST", `/sessions/${id}/permission-mode`, { mode }).catch(() => null),
  setSessionProfile: (id: string, profileId: string) =>
    req<{ profile_id: string; model_label: string | null }>("POST", `/sessions/${id}/profile`, { profile_id: profileId }),

  templates: () => req<{ templates: TemplateSummary[] }>("GET", "/templates"),

  // --- Models: select + add ---
  profiles: () =>
    req<{ profiles: ProfileSummary[]; active_profile_id: string | null }>("GET", "/models/profiles"),
  activateProfile: (id: string) =>
    req<{ active_profile_id: string }>("POST", `/models/profiles/${id}/activate`),
  providers: () => req<{ providers: ProviderSummary[] }>("GET", "/models/providers"),
  catalog: () => req<{ providers: CatalogProvider[] }>("GET", "/models/catalog"),
  addProvider: (body: { id: string; type?: "known" | "custom"; apiKey?: string; baseURL?: string; basedOn?: string; adapter?: string }) =>
    req<ProviderSummary>("POST", "/models/providers", body),
  deleteProvider: (id: string) => req<void>("DELETE", `/models/providers/${id}`),
  addProfile: (body: { providerId: string; model: string; label?: string; reasoning?: unknown; activate?: boolean }) =>
    req<ProfileSummary>("POST", "/models/profiles", body),
  deleteProfile: (id: string) => req<void>("DELETE", `/models/profiles/${id}`),

  // --- Permissions ---
  permissions: (id: string) => req<{ permissions: PermissionGrant[] }>("GET", `/sessions/${id}/permissions`),
  revokePermission: (id: string, key: string) =>
    req<void>("DELETE", `/sessions/${id}/permissions/${encodeURIComponent(key)}`),

  // --- Multi-agent roster ---
  agents: (id: string) => req<{ agents: AgentInfo[]; active_agent_id: string }>("GET", `/sessions/${id}/agents`),
  addAgent: (id: string, role: string, label?: string) =>
    req<{ agent_id: string; agents: AgentInfo[]; active_agent_id: string }>("POST", `/sessions/${id}/agents`, { role, label }),
  switchAgent: (id: string, agentId: string) =>
    req<{ agents: AgentInfo[]; active_agent_id: string }>("POST", `/sessions/${id}/agents/${agentId}`, {}),
  removeAgent: (id: string, agentId: string) =>
    req<{ agents: AgentInfo[]; active_agent_id: string }>("DELETE", `/sessions/${id}/agents/${agentId}`),

  setCredential: (id: string, provider: string, apiKey: string, model?: string) =>
    req<SessionDto>("POST", `/sessions/${id}/credentials`, { provider, apiKey, model }),
  clearCredential: (id: string) => req<void>("DELETE", `/sessions/${id}/credentials`),
};
