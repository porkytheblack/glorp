/**
 * The headline orchestration flow: create a session, send the first prompt, and
 * return a handle you can poll (`status`/`result`), stream (`events`), or stop
 * (`abort`). Defaults `permissionMode` to "auto" so unattended runs don't block
 * forever on a tool-permission prompt (use "bypass" for zero prompts).
 */

import { request } from "./rest.js";
import { streamSessionWith, type SessionStream } from "./ws.js";
import type { GlorpConfig } from "./config.js";
import type { BridgeEvent, PermissionMode, SessionDto, SessionResult } from "./contract.js";

export interface RunOptions {
  prompt: string;
  /** Run inside an existing first-class workspace... */
  workspaceId?: string;
  /** ...or against an absolute host path. */
  workspace?: string;
  permissionMode?: PermissionMode;
  provider?: string;
  model?: string;
  profileId?: string;
  template?: string;
  params?: Record<string, string>;
}

export interface ResultOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export interface RunHandle {
  sessionId: string;
  status(): Promise<SessionDto>;
  events(onEvent?: (event: BridgeEvent) => void): SessionStream;
  result(opts?: ResultOptions): Promise<SessionResult>;
  abort(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function sessionBody(o: RunOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { permissionMode: o.permissionMode ?? "auto" };
  if (o.provider) body.provider = o.provider;
  if (o.model) body.model = o.model;
  if (o.profileId) body.profileId = o.profileId;
  if (o.template) body.template = o.template;
  if (o.params) body.params = o.params;
  return body;
}

export function handle(cfg: GlorpConfig, sessionId: string): RunHandle {
  return {
    sessionId,
    status: () => request<SessionDto>(cfg, "GET", `/sessions/${sessionId}`),
    events: (onEvent) => streamSessionWith(cfg, sessionId, onEvent),
    abort: async () => {
      await request(cfg, "POST", `/sessions/${sessionId}/abort`);
    },
    async result({ pollMs = 800, timeoutMs = 600_000 }: ResultOptions = {}) {
      const deadline = Date.now() + timeoutMs;
      let everBusy = false;
      while (Date.now() < deadline) {
        const r = await request<SessionResult>(cfg, "GET", `/sessions/${sessionId}/result`);
        if (r.error) return r;
        if (r.busy) everBusy = true;
        else if (r.text !== null || (everBusy && r.turn_count > 0)) return r;
        await sleep(pollMs);
      }
      throw new Error(`run().result() timed out after ${timeoutMs}ms for session ${sessionId}`);
    },
  };
}

/** Create a session, send the first prompt, and return a run handle. */
export async function runWith(cfg: GlorpConfig, opts: RunOptions): Promise<RunHandle> {
  const created = opts.workspaceId
    ? await request<SessionDto>(cfg, "POST", `/workspaces/${opts.workspaceId}/sessions`, sessionBody(opts))
    : await request<SessionDto>(cfg, "POST", "/sessions", { workspace: opts.workspace, ...sessionBody(opts) });
  await request(cfg, "POST", `/sessions/${created.id}/messages`, { text: opts.prompt });
  return handle(cfg, created.id);
}
