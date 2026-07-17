// GENERATED from src/garage/contract.ts by packages/glorp-client/scripts/sync-contract.ts.
// Do not edit — run `bun run client:sync` after changing the server contract.

/**
 * The Glorp Garage **wire contract** — the public REST/WS types an external
 * client needs. This file is intentionally SELF-CONTAINED (zero imports) so the
 * `@porkytheblack/glorp-client` kit can vendor it verbatim (see
 * `packages/glorp-client/scripts/sync-contract.ts`). Keep it in sync with
 * `src/garage/types.ts`; `tests/garage-contract.test.ts` enforces that the
 * REST DTOs here stay structurally identical to the canonical ones at compile
 * time. Do not add imports.
 */

/** How tool-permission prompts are handled for a session. */
export type PermissionMode = "normal" | "auto" | "bypass";

/** Outer lifecycle envelope around a session. */
export type SessionLifecycle = "provisioning" | "idle" | "busy" | "error" | "destroyed";

/** A custom per-session model credential (the raw key is never returned). */
export interface SessionCredential {
  provider: string;
  apiKey: string;
  model?: string;
}

/** Public view of a namespace returned by the admin control-plane API. */
export interface NamespaceDto {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_default: boolean;
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
  slug?: string;
  /**
   * Optional companion template registry scoped to this namespace, so its
   * catalog is served by its own companion identity. `url` must be http(s);
   * `headers` (typically the tenant's bearer key) are stored server-side and
   * never returned by the API.
   */
  template_registry?: { url: string; headers?: Record<string, string> };
}

/** Body accepted by `POST /namespaces/:id/keys` (mints a namespace-bound key). */
export interface CreateNamespaceKeyInput {
  name: string;
  scopes?: string[];
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

/** Body accepted by `POST /sessions` and `POST /workspaces/:id/sessions`. */
export interface CreateSessionInput {
  sessionId?: string;
  workspaceId?: string;
  workspace?: string;
  template?: string;
  params?: Record<string, string>;
  provider?: string;
  model?: string;
  profileId?: string;
  permissionMode?: PermissionMode;
  credentials?: SessionCredential;
}

/** Public, secret-free view of a session returned by the REST API. */
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
  /** Cumulative estimated USD cost (catalog list pricing). */
  cost_usd: number;
  /** False when any attributed model lacked a catalog price (cost is a floor). */
  cost_known: boolean;
  turn_count: number;
  error: string | null;
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

/** One file in a session's `uploads/` exchange folder. */
export interface FileEntry {
  path: string;
  size: number;
  modified_at: string;
}

/** Remote-mirror sync state for a session's uploads folder. */
export interface FilesRemoteStatus {
  enabled: boolean;
  last_sync_at: string | null;
  error: string | null;
}

/** Returned by `GET /sessions/:id/files` and `POST /sessions/:id/files`. */
export interface FileListResponse {
  files: FileEntry[];
  /** Present when a remote uploads mirror (R2) is configured. */
  remote?: FilesRemoteStatus;
}

/**
 * Why `GET /sessions/:id/result` returned the `text` it did. Lets a caller tell
 * a genuine empty turn (`empty` — the agent ran and chose to write nothing) from
 * "no worker engaged yet" (`idle`/`provisioning`) and from a failure (`error`),
 * which all otherwise present as `{ busy:false, text:null, error:null }`.
 *   running       — a turn is in flight (busy)
 *   ok            — a completed turn produced text
 *   empty         — a turn completed but produced no text (real empty answer)
 *   idle          — no turn has run yet (created/rehydrated, never engaged)
 *   provisioning  — still setting up (template run / handle not built)
 *   error         — a fatal session failure, OR the last turn errored (e.g. a
 *                   model 400) while the session itself stayed healthy
 */
export type SessionResultReason = "running" | "ok" | "empty" | "idle" | "provisioning" | "error";

/** Returned by `GET /sessions/:id/result` — the latest agent answer + status. */
export interface SessionResult {
  status: SessionLifecycle;
  busy: boolean;
  text: string | null;
  /** Fatal, session-level error (the session is wedged in the `error` state). */
  error: string | null;
  /**
   * The most recent turn's error, when one failed (e.g. a model 400), even
   * though the session itself stayed healthy. Lets a polled consumer tell a
   * *failed* turn from an *empty* one (`busy:false`, `text:null`) without the
   * WebSocket stream. Null when the last turn succeeded or none has run.
   */
  last_error: string | null;
  /** Outcome of the most recent turn: `"error"`, `"ok"`, or null if none has run. */
  last_turn_state: "ok" | "error" | null;
  turn_count: number;
  /** Machine-readable explanation of `text`/status (see `SessionResultReason`). */
  reason: SessionResultReason;
}

/* ── Tasks: the simple black-box surface (POST /tasks …) ─────────────────── */

/**
 * Where a task is in its lifecycle. Projected live from the worker session on
 * every read, never stored.
 *   queued      — accepted; the workspace is provisioning / the first turn hasn't started
 *   staged      — created with `defer_start`: provisioned and holding the first turn so you
 *                 can upload input files (POST /tasks/:id/inputs), then POST /tasks/:id/start
 *   working     — the agent is actively processing
 *   needs_input — the agent asked the requester a question and is waiting (see `questions`)
 *   completed   — the agent finished (its declared deliverable, if any, is in `result`)
 *   failed      — provisioning failed, the session errored, or the last turn errored
 */
export type TaskStatus = "queued" | "staged" | "working" | "needs_input" | "completed" | "failed";

/** Kind of a pending question, derived from the agent's modal renderer. */
export type TaskQuestionKind = "choice" | "confirm" | "text" | "info";

/** A pending question the agent is blocking on — answer via POST /tasks/:id/answers. */
export interface TaskQuestion {
  id: string;
  kind: TaskQuestionKind;
  prompt: string;
  /** Present for `choice`: the offered options. */
  options?: Array<{ label: string; value: string; description?: string }>;
  /** Present for `text`: input hints. */
  placeholder?: string;
  initial?: string;
}

/** One deliverable file (lives in the task's uploads/ folder). */
export interface TaskFile {
  path: string;
  size: number;
  modified_at: string;
}

/** A task's result. `summary` + `data` come from the agent's deliver_result;
 *  `text` falls back to the last agent message when nothing was declared. */
export interface TaskResult {
  summary: string | null;
  text: string | null;
  files: TaskFile[];
  data?: unknown;
}

/**
 * A task's running token + cost meter, reported on every read so an external
 * system can audit consumption and price it. The counts are **cumulative over
 * the task's entire life** — across every follow-up message AND across context
 * compactions (the worker keeps a session-total counter that compaction never
 * resets), so a long-running, repeatedly-compacted task still reports its true
 * lifetime usage rather than just the current context window.
 *
 * `cost_usd` is an estimate from models.dev catalog **list pricing**;
 * `cost_known` is false when any attributed model lacked a catalog price (a
 * custom/local endpoint), in which case treat `cost_usd` as a floor, not an
 * exact bill.
 */
export interface TaskUsage {
  /** Cumulative input (prompt) tokens billed over the task's whole life. */
  tokens_in: number;
  /** Cumulative output (completion) tokens billed over the task's whole life. */
  tokens_out: number;
  /** Convenience sum: `tokens_in + tokens_out`. */
  tokens_total: number;
  /** Cumulative estimated USD cost (catalog list pricing). */
  cost_usd: number;
  /** False when any attributed model lacked a catalog price (cost is a floor). */
  cost_known: boolean;
}

/** A task type a consumer can submit — projected 1:1 from a setup template. */
export interface TaskTypeDto {
  name: string;
  description: string | null;
  inputs: TemplateParamDto[];
}

/** The task object — the entire black-box surface a simple consumer works with. */
export interface TaskDto {
  id: string;
  type: string;
  status: TaskStatus;
  title: string | null;
  result: TaskResult;
  questions: TaskQuestion[];
  /** Latest non-blocking progress note from the agent, if any. */
  progress: string | null;
  error: string | null;
  /** Cumulative token + cost meter (survives follow-ups and compactions). */
  usage: TaskUsage;
  created_at: string;
  updated_at: string;
}

/** Body accepted by `POST /tasks`. */
export interface CreateTaskInput {
  type: string;
  input: { prompt: string; params?: Record<string, string> };
  permission_mode?: PermissionMode;
  /** Garage POSTs the TaskDto here on needs_input / completed / failed. */
  callback_url?: string;
  /**
   * Hold the first turn after provisioning instead of running it immediately.
   * The task settles in `staged`; upload input files (POST /tasks/:id/inputs),
   * then POST /tasks/:id/start to run the prompt with those files present.
   */
  defer_start?: boolean;
}

/** Body accepted by `POST /tasks/:id/messages` (a follow-up). */
export interface PostTaskMessageInput {
  text: string;
}

/** Body accepted by `POST /tasks/:id/answers`. */
export interface PostTaskAnswerInput {
  question_id: string;
  answer: string | boolean | null;
}

/** A conversational agent in a session's multi-agent roster. */
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

/** A persisted tool-permission grant for a session. */
export interface PermissionGrant {
  key: string;
  status: string;
}

/** Public view of an API key (never includes the hash or the raw key). */
export interface ApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsed: string | null;
  expiresAt: string | null;
  revoked: boolean;
  /** Bound namespace, or null for unbound (admin/default) keys. */
  namespace?: string | null;
}

/**
 * Events streamed over a session WebSocket. This is an OPEN union: the
 * orchestration-relevant variants are typed, and the trailing member keeps it
 * forward-compatible so a client never breaks when Garage adds an event. The
 * authoritative, fully-typed union lives in `src/shared/events.ts`.
 */
export type BridgeEvent =
  | { type: "session_hydrate"; turns?: unknown[]; title?: string | null; stats?: unknown }
  | { type: "session_reset" }
  | { type: "title"; title: string | null }
  | { type: "turn"; turn: { id: string; kind: string; text?: string; [k: string]: unknown } }
  | { type: "text_delta"; text: string }
  | { type: "text_clear" }
  | { type: "tool_started"; tool: Record<string, unknown> }
  | { type: "tool_finished"; tool: Record<string, unknown> }
  | { type: "busy"; busy: boolean }
  | { type: "plan"; plan: unknown }
  | { type: "tasks"; tasks: unknown[] }
  | { type: "agent_roster"; agents: unknown[]; activeId: string }
  | { type: "display_slot_pushed"; slot: Record<string, unknown> }
  | { type: "display_slot_resolved"; slotId: string }
  | { type: "error"; message: string; detail?: string; kind?: "config" | "auth" | "modality" | "rate_limit" | "quota" | "network" | "upstream" | "internal"; hint?: string; retryAfterSec?: number }
  | { type: "model_status"; state: "waiting" | "active"; elapsedSec?: number }
  | { type: "queue_depth"; depth: number }
  // Forward-compatible fallback for every other server event.
  | { type: string; [k: string]: unknown };

/** Wire envelope for every event pushed over a session WebSocket. */
export interface EventEnvelope {
  sessionId: string;
  seq: number;
  event: BridgeEvent;
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
