import type { GlorpStore } from "../store.ts";
import type { BridgeEvent } from "../../shared/events.ts";
import type { InboxEntry, TaskItem } from "../../shared/events.ts";
import { storeTotals } from "../usage.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
}

export function createRefreshers(
  store: GlorpStore,
  bridge: Bridge,
  contextLimit: number | (() => number),
) {
  const limitOf = typeof contextLimit === "function" ? contextLimit : () => contextLimit;
  async function stats() {
    try {
      // Window counts drive the context-fill meter (they reset on compaction);
      // cumulative counts + the ledger drive the session token/cost totals (they
      // survive compaction). Showing the window here is what made totals read low.
      const window = await store.getTokenCounts();
      const cum = store.countersSync();
      const totals = storeTotals(cum.tokensIn, cum.tokensOut, store.getUsage());
      bridge.emit({
        type: "stats",
        stats: {
          turns: cum.turnCount,
          tokens_in: totals.tokensIn,
          tokens_out: totals.tokensOut,
          contextPct: Math.min(100, Math.round(((window.in + window.out) / limitOf()) * 100)),
          cost_usd: totals.costUsd,
          cost_known: totals.costKnown,
        },
      });
    } catch {}
  }

  async function tasks() {
    try {
      const items: TaskItem[] = ((await store.getTasks?.()) ?? []).map((t) => ({
        id: t.id,
        content: t.content,
        activeForm: t.activeForm,
        status: t.status,
      }));
      bridge.emit({ type: "tasks", tasks: items });
    } catch {}
  }

  async function plan() {
    try {
      bridge.emit({ type: "plan", plan: await store.getPlan() });
    } catch {}
  }

  async function inbox() {
    try {
      const items: InboxEntry[] = ((await store.getInboxItems?.()) ?? []).map((i) => ({
        id: i.id,
        tag: i.tag,
        request: i.request,
        response: i.response,
        status: i.status,
        blocking: i.blocking,
        createdAt: i.created_at,
        resolvedAt: i.resolved_at,
      }));
      bridge.emit({ type: "inbox", items });
    } catch {}
  }

  return { stats, plan, tasks, inbox, all: () => void Promise.all([stats(), plan(), tasks(), inbox()]) };
}
