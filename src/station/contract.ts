/**
 * The Glorp Station **wire contract** — the public REST/WS types an external
 * client needs. This file is intentionally SELF-CONTAINED (zero imports) so the
 * `@porkytheblack/glorp-client` kit can vendor it verbatim (see
 * `packages/glorp-client/scripts/sync-contract.ts`). Keep it in sync with
 * `src/station/types.ts`; `tests/station-contract.test.ts` enforces that the
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
}

/** Body accepted by `POST /namespaces`. */
export interface CreateNamespaceInput {
  name: string;
  slug?: string;
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
}

/** Body accepted by `POST /workspaces`. */
export interface CreateWorkspaceInput {
  name?: string;
  path?: string;
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
  turn_count: number;
  error: string | null;
  custom_credentials: { provider: string; last4: string } | null;
}

/** One file in a session's `uploads/` exchange folder. */
export interface FileEntry {
  path: string;
  size: number;
  modified_at: string;
}

/** Returned by `GET /sessions/:id/files` and `POST /sessions/:id/files`. */
export interface FileListResponse {
  files: FileEntry[];
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
 * forward-compatible so a client never breaks when Station adds an event. The
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
  | { type: "error"; message: string; detail?: string }
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
