/** Builds the public, secret-free REST view of a session. */

import type { GarageSession } from "./session.ts";
import type { SessionDto } from "./types.ts";
import { totalsOf } from "../agent/usage.ts";

export function buildSessionDto(s: GarageSession): SessionDto {
  const handle = s.current();
  // A registered-but-unbuilt session has no live stats yet (no events fired) —
  // read its persisted counters + usage ledger straight off the snapshot so its
  // tokens/turns/cost don't read as 0 until the handle is built and hydrated.
  const counters = s.loaded ? null : peekCounters(s);
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

/** Persisted counters + cost for an unbuilt session, read off its snapshot. */
function peekCounters(s: GarageSession): { tokensIn: number; tokensOut: number; turnCount: number; costUsd: number; costKnown: boolean } {
  const store = s.peekStore();
  const c = store.countersSync();
  const totals = totalsOf(store.getUsage());
  return { ...c, costUsd: totals.costUsd, costKnown: totals.costKnown };
}

function last4(key: string): string {
  return key.length <= 4 ? key : key.slice(-4);
}
