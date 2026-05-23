import type { GlorpStore } from "../store.ts";
import type { BridgeEvent } from "../../shared/events.ts";
import type { InboxEntry, TaskItem } from "../../shared/events.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
}

export function createRefreshers(
  store: GlorpStore,
  bridge: Bridge,
  contextLimit: number,
) {
  async function stats() {
    try {
      const tokens = await store.getTokenCount();
      const turns = await store.getTurnCount();
      bridge.emit({
        type: "stats",
        stats: {
          turns,
          tokens_in: tokens,
          tokens_out: 0,
          contextPct: Math.min(100, Math.round((tokens / contextLimit) * 100)),
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
