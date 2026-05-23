import type { ModelAdapter } from "glove-core/core";
import type { BridgeEvent } from "../../shared/events.ts";
import type { GlorpStore } from "../store.ts";
import { generateSessionTitle } from "./title.ts";

interface Bridge {
  emit(event: BridgeEvent): void;
}

export function createTitleScheduler(args: {
  store: GlorpStore;
  bridge: Bridge;
  model: ModelAdapter;
  initialTitle: string | null;
  timeoutMs: number;
}) {
  let title = args.initialTitle;
  let model = args.model;
  let requestInFlight = false;
  let generation: Promise<void> | null = null;
  let abortController: AbortController | null = null;

  async function cancel() {
    if (!generation) return;
    abortController?.abort();
    try { await generation; } catch {}
  }

  function schedule() {
    if (title || generation || requestInFlight) return;
    abortController = new AbortController();
    const timeout = setTimeout(() => abortController?.abort(), args.timeoutMs);
    generation = (async () => {
      try {
        const next = await generateSessionTitle(model, await args.store.getDisplayMessages(), abortController?.signal);
        if (!next || title) return;
        title = next;
        await args.store.setTitle(next);
        args.bridge.emit({ type: "title", title: next });
      } catch {
      } finally {
        clearTimeout(timeout);
        abortController = null;
        generation = null;
      }
    })();
  }

  return {
    get title() { return title; },
    setModel(next: ModelAdapter) { model = next; },
    setRequestInFlight(next: boolean) { requestInFlight = next; },
    async refreshTitle() { title = await args.store.getTitle(); },
    cancel,
    schedule,
  };
}
