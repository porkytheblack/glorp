/** Builds the public, secret-free REST view of a session. */

import type { GarageSession } from "./session.ts";
import type { SessionDto } from "./types.ts";
import { snapshotExists } from "./persistence.ts";
import { storeTotals } from "../agent/usage.ts";

export function buildSessionDto(s: GarageSession): SessionDto {
  const handle = s.current();
  const u = sessionUsage(s);
  return {
    id: s.id,
    state: s.state,
    workspace: s.workspace,
    workspace_id: s.workspaceId,
    title: s.stats.title,
    model_label: handle?.modelLabel ?? null,
    permission_mode: handle?.permissionMode ?? s.defaultPermissionMode,
    created_at: new Date(s.createdAt).toISOString(),
    last_activity: new Date(s.lastActivity).toISOString(),
    connected_clients: s.stream.size,
    busy: s.stats.busy,
    loaded: s.loaded,
    tokens_in: u.tokensIn,
    tokens_out: u.tokensOut,
    cost_usd: u.costUsd,
    cost_known: u.costKnown,
    turn_count: u.turnCount,
    error: s.error,
    custom_credentials: s.customCredential
      ? { provider: s.customCredential.provider, last4: last4(s.customCredential.apiKey) }
      : null,
  };
}

/** Resolved token + cost usage for a session. */
export interface SessionUsage {
  tokensIn: number;
  tokensOut: number;
  turnCount: number;
  costUsd: number;
  costKnown: boolean;
}

/**
 * Cumulative token + cost usage for a session — the single source the session
 * DTO and the Task DTO both report. Reads counters + cost straight off the
 * store (the live handle store when loaded, else the snapshot), which are
 * SESSION-cumulative and so survive context compaction; falls back to the live
 * `SessionStats` (folded from bridge events) for a built-but-unflushed session
 * that has no snapshot yet.
 */
export function sessionUsage(s: GarageSession): SessionUsage {
  const c = peekCounters(s);
  return {
    tokensIn: c?.tokensIn ?? s.stats.tokensIn,
    tokensOut: c?.tokensOut ?? s.stats.tokensOut,
    turnCount: c?.turnCount ?? s.stats.turnCount,
    costUsd: c?.costUsd ?? s.stats.costUsd,
    costKnown: c?.costKnown ?? s.stats.costKnown,
  };
}

/** Counters + cost from the store (live when loaded, snapshot when present),
 *  or null when there is nothing persisted yet — caller falls back to stats. */
function peekCounters(
  s: GarageSession,
): { tokensIn: number; tokensOut: number; turnCount: number; costUsd: number; costKnown: boolean } | null {
  if (!s.loaded && !snapshotExists(s.dataDir, s.id)) return null;
  const store = s.peekStore();
  const c = store.countersSync();
  const totals = storeTotals(c.tokensIn, c.tokensOut, store.getUsage());
  return { ...c, costUsd: totals.costUsd, costKnown: totals.costKnown };
}

function last4(key: string): string {
  return key.length <= 4 ? key : key.slice(-4);
}
