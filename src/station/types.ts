/**
 * Shared types for Glorp Station — the multi-session runtime that hosts a
 * REST + WebSocket API over many concurrent GlorpHandle instances.
 */

import type { BridgeEvent } from "../shared/events.ts";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";

/**
 * Outer lifecycle envelope around a session. The inner idle/busy transitions
 * come from the agent's `busy` BridgeEvent; Station adds provisioning (template
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

/** Body accepted by `POST /sessions`. */
export interface CreateSessionInput {
  sessionId?: string;
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
  /** Custom API key that overrides the Station default for this session. */
  credentials?: SessionCredential;
}

/** Public, secret-free view of a session returned by the REST API. */
export interface SessionDto {
  id: string;
  state: SessionLifecycle;
  workspace: string;
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
  turn_count: number;
  error: string | null;
  /** Present only when a session-level custom key is set. Never the raw key. */
  custom_credentials: { provider: string; last4: string } | null;
}
