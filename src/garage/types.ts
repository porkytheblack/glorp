/**
 * Shared types for Glorp Garage — the multi-session runtime that hosts a
 * REST + WebSocket API over many concurrent GlorpHandle instances.
 */

import type { BridgeEvent } from "../shared/events.ts";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";

/**
 * Outer lifecycle envelope around a session. The inner idle/busy transitions
 * come from the agent's `busy` BridgeEvent; Garage adds provisioning (template
 * running), error (unrecoverable agent failure) and destroyed.
 */
export type SessionLifecycle =
  | "provisioning"
  | "idle"
  | "busy"
  | "error"
  | "destroyed";

/** Wire envelope for every event pushed over a session WebSocket. */
export interface EventEnvelope {
  sessionId: string;
  seq: number;
  event: BridgeEvent;
}

/**
 * A custom per-session model credential. Held in memory only and never
 * persisted to disk (open question 7, recommendation b). The raw key is never
 * logged or returned over the API — only `provider` and the last 4 chars.
 */
export interface SessionCredential {
  provider: string;
  apiKey: string;
  model?: string;
}

/**
 * A tenant namespace: an isolated data partition. Each namespace owns its own
 * `dataDir` subtree (sessions, workspaces.json, credentials.json) and its own
 * sandbox `workspaceRoot`, so one tenant's SessionManager can never touch
 * another's. The synthesized `default` namespace points `dataDir`/`workspaceRoot`
 * at the garage's legacy roots, keeping existing single-tenant installs working
 * with zero migration. Tenant namespaces are persisted in `namespaces.json`.
 */
export interface Namespace {
  /** "default" or "ns_<slug>" — URL- and filesystem-path-safe, stable. */
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /** Absolute data subtree. For "default" this IS the garage's legacy dataDir. */
  dataDir: string;
  /** Absolute sandbox root. For "default" this IS the garage's workspaceRoot. */
  workspaceRoot: string;
  /**
   * This namespace's OWN companion template registry — its templates come from
   * its own companion identity (its own key), layered over the garage-global
   * catalog. Absent ⇒ the namespace inherits only the garage-global sources.
   */
  templateRegistry?: NamespaceTemplateRegistry;
}

/** A namespace-scoped companion registry: a base URL + static auth headers. */
export interface NamespaceTemplateRegistry {
  /** Companion base list URL, e.g. `https://svc/v1/templates`. */
  url: string;
  /** Static headers sent on every GET — typically the tenant's bearer key. */
  headers?: Record<string, string>;
}

/** Public view of a namespace returned by the admin control-plane API. */
export interface NamespaceDto {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  /** True only for the reserved, always-present `default` namespace. */
  is_default: boolean;
  /** Live+dormant session count. Present on detail reads; omitted from lists. */
  session_count?: number;
  /** Cumulative input tokens across the namespace's sessions. */
  tokens_in?: number;
  /** Cumulative output tokens across the namespace's sessions. */
  tokens_out?: number;
  /** Cumulative estimated USD cost (catalog list pricing). */
  cost_usd?: number;
  /** False when any contributing model lacked a catalog price. */
  cost_known?: boolean;
  /** This namespace's own companion registry URL, if configured (headers never returned). */
  template_registry_url?: string | null;
}

/** Body accepted by `POST /namespaces`. */
export interface CreateNamespaceInput {
  name: string;
  /** Optional explicit slug; otherwise derived from `name`. */
  slug?: string;
  /**
   * Optional companion template registry scoped to this namespace, so its
   * template catalog is served by its own companion identity. `url` must be
   * http(s); `headers` are stored server-side and never returned by the API.
   */
  template_registry?: { url: string; headers?: Record<string, string> };
}

/** Body accepted by `POST /namespaces/:id/keys` (mints a namespace-bound key). */
export interface CreateNamespaceKeyInput {
  name: string;
  /** Tenant scopes. `admin` is rejected (it would defeat isolation). */
  scopes?: string[];
}

/**
 * A first-class workspace: one project = one folder on disk = a collection of
 * chat sessions that all share that folder. Persisted in `workspaces.json`.
 */
export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

/** Public view of a workspace returned by the REST API. */
export interface WorkspaceDto {
  id: string;
  name: string;
  path: string;
  created_at: string;
  session_count: number;
  /** Cumulative input tokens across this workspace's sessions. */
  tokens_in: number;
  /** Cumulative output tokens across this workspace's sessions. */
  tokens_out: number;
  /** Cumulative estimated USD cost (catalog list pricing). */
  cost_usd: number;
  /** False when any contributing model lacked a catalog price. */
  cost_known: boolean;
}

/** Body accepted by `POST /workspaces`. */
export interface CreateWorkspaceInput {
  name?: string;
  path?: string;
  /** Provision the (new or adopted) workspace from a named template. */
  template?: string;
  /** Values for the template's declared `{param:NAME}` placeholders. */
  params?: Record<string, string>;
}

/** One declared template parameter, for client-side form rendering. */
export interface TemplateParamDto {
  name: string;
  description: string | null;
  required: boolean;
  default: string | null;
  secret: boolean;
}

/** Summary of a setup template returned by `GET /templates`. */
export interface TemplateSummaryDto {
  name: string;
  description: string | null;
  step_count: number;
  repo_count: number;
  skill_count: number;
  mcp_count: number;
  env_count: number;
  has_system_prompt: boolean;
  params: TemplateParamDto[];
}

/** Secret-free remote-storage settings returned by `GET /storage`. */
export interface StorageConfigDto {
  enabled: boolean;
  endpoint: string | null;
  bucket: string | null;
  prefix: string | null;
  access_key_id: string | null;
  has_secret: boolean;
}

/** Body accepted by `PUT /storage` (secret is write-only; omit to keep it). */
export interface UpdateStorageConfigInput {
  enabled?: boolean;
  endpoint?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  access_key_id?: string | null;
  secret_access_key?: string | null;
}

/** Body accepted by `POST /sessions`. */
export interface CreateSessionInput {
  sessionId?: string;
  /** Create the session inside an existing first-class workspace. */
  workspaceId?: string;
  /** Absolute path to an existing workspace directory on the host. */
  workspace?: string;
  /** Name of a setup template to provision a fresh workspace from. */
  template?: string;
  /** Interpolation params for the template (`{param:NAME}`). */
  params?: Record<string, string>;
  provider?: string;
  model?: string;
  /** Pre-existing model profile id to activate for this session. */
  profileId?: string;
  permissionMode?: PermissionMode;
  /** Custom API key that overrides the Garage default for this session. */
  credentials?: SessionCredential;
}

/** Public, secret-free view of a session returned by the REST API. */
export interface SessionDto {
  id: string;
  state: SessionLifecycle;
  workspace: string;
  /** Id of the first-class workspace this session belongs to (null if legacy). */
  workspace_id: string | null;
  title: string | null;
  model_label: string | null;
  permission_mode: PermissionMode;
  created_at: string;
  last_activity: string;
  connected_clients: number;
  busy: boolean;
  /** Whether the GlorpHandle is currently live in memory. */
  loaded: boolean;
  tokens_in: number;
  tokens_out: number;
  /** Cumulative estimated USD cost (catalog list pricing). */
  cost_usd: number;
  /** False when any attributed model lacked a catalog price (cost is a floor). */
  cost_known: boolean;
  turn_count: number;
  error: string | null;
  /** Present only when a session-level custom key is set. Never the raw key. */
  custom_credentials: { provider: string; last4: string } | null;
}

/** One model's slice of a session's (or rollup's) token + cost usage. */
export interface ModelUsageDto {
  provider_id: string;
  model: string;
  label: string | null;
  tokens_in: number;
  tokens_out: number;
  /** Model turns attributed to this model. */
  requests: number;
  cost_usd: number;
  cost_known: boolean;
}

/** A rolled-up token + cost total. */
export interface UsageTotalsDto {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  cost_known: boolean;
}

/** Returned by `GET /sessions/:id/usage` — one session's per-model breakdown. */
export interface SessionUsageDto {
  session_id: string;
  totals: UsageTotalsDto;
  models: ModelUsageDto[];
}

/** Per-workspace usage line in the namespace rollup. */
export interface WorkspaceUsageDto {
  workspace_id: string | null;
  name: string;
  totals: UsageTotalsDto;
}

/** Per-session usage line in the namespace rollup. */
export interface SessionUsageLineDto {
  session_id: string;
  title: string | null;
  workspace_id: string | null;
  model_label: string | null;
  totals: UsageTotalsDto;
}

/** Returned by `GET /usage` — the namespace-wide spend rollup. */
export interface NamespaceUsageDto {
  namespace: string;
  totals: UsageTotalsDto;
  by_model: ModelUsageDto[];
  by_workspace: WorkspaceUsageDto[];
  by_session: SessionUsageLineDto[];
}

/** One MCP identity (e.g. a Linear workspace) supplied at provision time. */
export interface McpIdentityInput {
  name: string;
  token: string;
  label?: string;
}

/** Body accepted by `POST /workspaces/:id/mcp` — install or refresh one MCP provider. */
export interface ProvisionMcpInput {
  provider: string;
  url: string;
  identities: McpIdentityInput[];
  defaultIdentity?: string;
}

/** Tool-level diff returned by an MCP add/sync. */
export interface McpSyncDiff {
  provider: string;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  error?: string;
}

/** Public view of an installed MCP provider (never includes tokens). */
export interface McpProviderDto {
  provider: string;
  url: string;
  default_identity: string | null;
  identities: Array<{ name: string; label?: string }>;
  tools: string[];
  synced_at: string;
}
