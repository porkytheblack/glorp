import type { Context } from "glove-core/core";

export const FLEET_SIGNAL_KINDS = ["research", "edit-fanout", "shell-fanout"] as const;
export type FleetSignalKind = (typeof FLEET_SIGNAL_KINDS)[number];

export interface FleetJobInput {
  itemId: string;
  tag: string;
  payload: string;
  name?: string;
}

export interface FleetJobConfig {
  /** Workspace root the worker should operate in. */
  workspace: string;
  /** Data directory (~/.glorp by default) — workers need this for credentials. */
  dataDir: string;
  /** CLI-supplied provider override for the worker's model. */
  provider?: string;
  /** CLI-supplied model override. */
  model?: string;
}

export interface FleetJobResult {
  ok: boolean;
  response: string;
  startedAt: number;
  endedAt: number;
}

export type InboxResolver = (
  itemId: string,
  response: string,
  status: "resolved" | "error",
) => Promise<void>;

export interface FleetJobHandle {
  jobId: string;
  kind: FleetSignalKind;
  itemId: string;
  tag: string;
  name?: string;
  startedAt: number;
}

export interface FleetEvents {
  onStart?: (handle: FleetJobHandle) => void;
  onFinish?: (handle: FleetJobHandle, result: FleetJobResult) => void;
}

export interface GlorpFleet {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatch(kind: FleetSignalKind, input: FleetJobInput): Promise<string>;
  setInboxResolver(fn: InboxResolver): void;
  setContext(ctx: Context | null): void;
  /** Snapshot of currently-running jobs — used by the UI fleet strip. */
  listActive(): FleetJobHandle[];
  /** Subscribe to start/finish lifecycle events. Returns an unsubscribe fn. */
  subscribe(events: FleetEvents): () => void;
}
