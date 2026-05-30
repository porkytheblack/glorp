/**
 * Thin REST client for the Station API. Same-origin in production (the
 * dashboard is served by Station); proxied to Station in dev via vite.config.
 */

import type { SessionDto } from "../types.ts";

export interface CreateSessionBody {
  workspace?: string;
  template?: string;
  params?: Record<string, string>;
  provider?: string;
  model?: string;
  profileId?: string;
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
  profiles: () =>
    req<{ profiles: ProfileSummary[]; active_profile_id: string | null }>("GET", "/models/profiles"),
  activateProfile: (id: string) =>
    req<{ active_profile_id: string }>("POST", `/models/profiles/${id}/activate`),

  setCredential: (id: string, provider: string, apiKey: string, model?: string) =>
    req<SessionDto>("POST", `/sessions/${id}/credentials`, { provider, apiKey, model }),
  clearCredential: (id: string) => req<void>("DELETE", `/sessions/${id}/credentials`),
};
