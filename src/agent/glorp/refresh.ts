import type { Bridge } from "../../shared/bridge.ts";
import type { GlorpStore } from "../store.ts";
import type { TaskItem, InboxEntry } from "../../shared/events.ts";
import { CONTEXT_LIMIT } from "./types.ts";

/**
 * Periodic-ish UI refresh helpers. The agent half emits bridge events
 * after every state-changing event; these read the store and push the
 * latest tasks/inbox/stats so the React store can rerender.
 */
export function makeRefresh(store: GlorpStore, bridge: Bridge): {
  refreshStats(): Promise<void>;
  refreshTasks(): Promise<void>;
  refreshInbox(): Promise<void>;
} {
  return {
    async refreshStats() {
      try {
        const tokens = await store.getTokenCount();
        const turns = await store.getTurnCount();
        bridge.emit({
          type: "stats",
          stats: {
            turns,
            tokens_in: tokens,
            tokens_out: 0,
            contextPct: Math.min(100, Math.round((tokens / CONTEXT_LIMIT) * 100)),
          },
        });
      } catch {}
    },
    async refreshTasks() {
      try {
        const tasks = (await store.getTasks?.()) ?? [];
        const items: TaskItem[] = tasks.map((t) => ({
          id: t.id,
          content: t.content,
          activeForm: t.activeForm,
          status: t.status,
        }));
        bridge.emit({ type: "tasks", tasks: items });
      } catch {}
    },
    async refreshInbox() {
      try {
        const items = (await store.getInboxItems?.()) ?? [];
        const entries: InboxEntry[] = items.map((i) => ({
          id: i.id,
          tag: i.tag,
          request: i.request,
          response: i.response,
          status: i.status,
          blocking: i.blocking,
          createdAt: i.created_at,
          resolvedAt: i.resolved_at,
        }));
        bridge.emit({ type: "inbox", items: entries });
      } catch {}
    },
  };
}
