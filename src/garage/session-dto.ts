/** Builds the public, secret-free REST view of a session. */

import type { GarageSession } from "./session.ts";
import type { SessionDto } from "./types.ts";
import { snapshotExists } from "./persistence.ts";
import { storeTotals } from "../agent/usage.ts";

export function buildSessionDto(s: GarageSession): SessionDto {
  const handle = s.current();
  // The live `SessionStats` is only populated by bridge events (hydrate / token
  // consumption), so a session that's built-but-unhydrated or merely rehydrated
  // would read as 0. Read counters + cost straight off the store instead: the
  // live handle store when loaded, else the snapshot — but only when one exists,
  // so listing a freshly-created, never-flushed session doesn't construct a
  // store (which would create an empty session folder on a read path).
  const counters = peekCounters(s);
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
    tokens_in: counters?.tokensIn ?? s.stats.tokensIn,
    tokens_out: counters?.tokensOut ?? s.stats.tokensOut,
    cost_usd: counters?.costUsd ?? s.stats.costUsd,
    cost_known: counters?.costKnown ?? s.stats.costKnown,
    turn_count: counters?.turnCount ?? s.stats.turnCount,
    error: s.error,
    custom_credentials: s.customCredential
      ? { provider: s.customCredential.provider, last4: last4(s.customCredential.apiKey) }
      : null,
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
