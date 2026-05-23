import type { Message, ModelAdapter } from "glove-core/core";
import { generateSessionTitle, TITLE_MODEL_TIMEOUT_MS } from "./title.ts";
import { messagesToChatTurns, modelResultHasVisibleAgentOutput } from "./messages.ts";
import type { Bridge } from "../../shared/bridge.ts";
import type { GlorpStore } from "../store.ts";
import type { IGloveRunnable } from "glove-core/glove";
import type { SubscriberState } from "./subscriber.ts";

export interface RuntimeDeps {
  agent: IGloveRunnable;
  store: GlorpStore;
  bridge: Bridge;
  sessionId: string;
  state: SubscriberState;
  refresh: { refreshStats(): Promise<void>; refreshTasks(): Promise<void>; refreshInbox(): Promise<void> };
  model: ModelAdapter;
}

export interface Runtime {
  title: string | null;
  abortController: AbortController | null;
  cancelTitleGeneration(): Promise<void>;
  hydrateUi(): Promise<void>;
  send(text: string): Promise<void>;
  abort(): void;
  shutdown(onShutdown: () => Promise<void>): Promise<void>;
  scheduleTitle(): void;
}

/** Stateful runtime backing the GlorpHandle. */
export function createRuntime(deps: RuntimeDeps): Runtime {
  let title: string | null = null;
  let abortController: AbortController | null = null;
  let titleGeneration: Promise<void> | null = null;
  let titleAbort: AbortController | null = null;
  let requestInFlight = false;

  const cancelTitleGeneration = async () => {
    if (!titleGeneration) return;
    titleAbort?.abort();
    try { await titleGeneration; } catch {}
  };

  const scheduleTitle = () => {
    if (title || titleGeneration || requestInFlight) return;
    titleAbort = new AbortController();
    const timeout = setTimeout(() => titleAbort?.abort(), TITLE_MODEL_TIMEOUT_MS);
    titleGeneration = (async () => {
      try {
        const messages = await deps.store.getMessages();
        const next = await generateSessionTitle(deps.model, messages, titleAbort?.signal);
        if (next && !title) {
          title = next;
          await deps.store.setTitle(next);
          deps.bridge.emit({ type: "title", title: next });
        }
      } catch {} finally {
        clearTimeout(timeout);
        titleAbort = null;
        titleGeneration = null;
      }
    })();
  };

  const hydrateUi = async () => {
    const messages = await deps.store.getMessages();
    title = await deps.store.getTitle();
    deps.bridge.emit({
      type: "hydrate",
      state: { turns: messagesToChatTurns(deps.sessionId, messages), title },
    });
    await deps.refresh.refreshStats();
    await deps.refresh.refreshTasks();
    await deps.refresh.refreshInbox();
    scheduleTitle();
  };

  const send = async (text: string) => {
    abortController?.abort();
    await cancelTitleGeneration();
    abortController = new AbortController();
    deps.state.requestAborted = false;
    deps.state.emittedAgentTexts = new Set();
    requestInFlight = true;
    deps.bridge.emit({ type: "busy", busy: true });
    deps.bridge.emit({
      type: "turn",
      turn: { id: `u_${Date.now().toString(36)}`, kind: "user", text, createdAt: Date.now() },
    });
    try {
      const result = await deps.agent.processRequest(text, abortController.signal);
      if (!deps.state.requestAborted && !modelResultHasVisibleAgentOutput(result as Message)) {
        deps.bridge.emit({
          type: "turn",
          turn: { id: `s_${Date.now().toString(36)}`, kind: "system", text: "*model returned no visible response after retry*", createdAt: Date.now() },
        });
      }
    } catch (err: any) {
      if (deps.state.requestAborted) return;
      if (err?.name === "AbortError") {
        deps.bridge.emit({
          type: "turn",
          turn: { id: `s_${Date.now().toString(36)}`, kind: "system", text: "*aborted by friend-shape*", createdAt: Date.now() },
        });
      } else {
        deps.bridge.emit({ type: "error", message: err?.message ?? String(err) });
      }
    } finally {
      requestInFlight = false;
      deps.bridge.emit({ type: "busy", busy: false });
      void deps.refresh.refreshStats();
      void deps.refresh.refreshTasks();
      void deps.refresh.refreshInbox();
      if (!deps.state.requestAborted) scheduleTitle();
    }
  };

  const abort = () => {
    if (!abortController || abortController.signal.aborted) return;
    deps.state.requestAborted = true;
    abortController?.abort();
    requestInFlight = false;
    deps.state.streamingTextBuffer = "";
    deps.state.activeTools.clear();
    deps.bridge.emit({ type: "text_clear" });
    deps.bridge.emit({ type: "busy", busy: false });
    deps.bridge.emit({
      type: "turn",
      turn: { id: `s_${Date.now().toString(36)}`, kind: "system", text: "*aborted by friend-shape*", createdAt: Date.now() },
    });
  };

  const shutdown = async (onShutdown: () => Promise<void>) => {
    abortController?.abort();
    await cancelTitleGeneration();
    await onShutdown();
  };

  return {
    get title() { return title; },
    get abortController() { return abortController; },
    cancelTitleGeneration, hydrateUi, send, abort, shutdown, scheduleTitle,
  };
}
