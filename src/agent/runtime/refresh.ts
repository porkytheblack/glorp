import type { GlorpStore } from "../store.ts";
import type { BridgeEvent } from "../../shared/events.ts";
import type { InboxEntry, TaskItem } from "../../shared/events.ts";
import { totalsOf } from "../usage.ts";

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
      const counts = await store.getTokenCounts();
      const turns = await store.getTurnCount();
      const total = counts.in + counts.out;
      const usage = totalsOf(store.getUsage());
      bridge.emit({
        type: "stats",
        stats: {
          turns,
          tokens_in: counts.in,
          tokens_out: counts.out,
          contextPct: Math.min(100, Math.round((total / limitOf()) * 100)),
          cost_usd: usage.costUsd,
          cost_known: usage.costKnown,
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
