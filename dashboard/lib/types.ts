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

/** Wire shape of a configured provider (src/garage/routes/models.ts#providerDto). */
export interface ProviderWire {
  id: string;
  type: "known" | "custom";
  based_on: string | null;
  adapter: string | null;
  base_url: string | null;
  context_limit: number | null;
  has_api_key: boolean;
}

/** Wire shape of a model profile (src/garage/routes/models.ts#profileDto). */
export interface ProfileWire {
  id: string;
  label: string;
  provider_id: string;
  model: string;
  last_used_at: string | null;
}

/** A known provider from GET /models/catalog — drives guided pickers. */
export interface CatalogProvider {
  id: string;
  label: string;
  description: string;
  env_var: string | null;
  default_models: string[];
  needs_api_key: boolean;
  reasoning_capable: boolean;
}

/** A custom-endpoint adapter from GET /models/catalog. */
export interface CatalogAdapter {
  id: string;
  label: string;
  description: string;
}

export interface Catalog {
  providers: CatalogProvider[];
  adapters: CatalogAdapter[];
}

/** One reasoning/thinking choice from GET /models/reasoning-options. */
export interface ReasoningOption {
  label: string;
  description?: string;
  value: unknown;
}

export interface TemplateDto {
  name: string;
  description?: string;
  step_count?: number;
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

/* ── Live session / chat model (mirrors src/shared/events.ts) ───────────── */

export interface ToolEvent {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "success" | "error" | "aborted";
  output?: string;
  startedAt: number;
  endedAt?: number;
}

export interface ChatTurn {
  id: string;
  kind: "user" | "agent" | "tool" | "system" | "transmission";
  text?: string;
  reasoning?: string;
  tool?: ToolEvent;
  meta?: Record<string, unknown>;
  createdAt: number;
  /** UI-only: mark a system turn as an error. */
  error?: boolean;
}

export interface TaskItem {
  id: string;
  content: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SessionStats {
  turns: number;
  tokens_in: number;
  tokens_out: number;
  contextPct: number;
}

export interface DisplaySlot {
  slotId: string;
  renderer: string;
  input: unknown;
  createdAt: number;
  isPermissionRequest: boolean;
}
