/** Lean DTO mirror of the Garage wire contract (src/garage/contract.ts). */

export type PermissionMode = "normal" | "auto" | "bypass";
export type SessionLifecycle = "provisioning" | "idle" | "busy" | "error" | "destroyed";

export interface NamespaceDto {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_default: boolean;
  session_count?: number;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  path: string;
  created_at: string;
  session_count: number;
}

export interface SessionDto {
  id: string;
  state: SessionLifecycle;
  workspace: string;
  workspace_id: string | null;
  title: string | null;
  model_label: string | null;
  permission_mode: PermissionMode;
  created_at: string;
  last_activity: string;
  connected_clients: number;
  busy: boolean;
  loaded: boolean;
  tokens_in: number;
  tokens_out: number;
  turn_count: number;
  error: string | null;
  custom_credentials: { provider: string; last4: string } | null;
}

export interface AgentInfo {
  id: string;
  label: string;
  role: string;
  active: boolean;
  busy: boolean;
  turnCount: number;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsed: string | null;
  expiresAt: string | null;
  revoked: boolean;
  namespace?: string | null;
}

export interface ProviderDto {
  id: string;
  type: "known" | "custom";
  label?: string;
  baseURL?: string;
  hasKey?: boolean;
  models?: string[];
}

export interface ProfileDto {
  id: string;
  label: string;
  providerId: string;
  model: string;
  reasoning?: unknown;
}

export interface TemplateDto {
  name: string;
  description?: string;
  steps?: unknown[];
}

export interface Identity {
  authenticated: boolean;
  user?: string;
  scopes?: string[];
  is_admin?: boolean;
}

export interface EventEnvelope {
  sessionId: string;
  seq: number;
  event: { type: string; [k: string]: unknown };
}
