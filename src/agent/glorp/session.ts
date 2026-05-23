import type { IGloveRunnable } from "glove-core/glove";
import type { ModelAdapter } from "glove-core/core";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { Bridge } from "../../shared/bridge.ts";
import type { GlorpStore } from "../store.ts";
import type { CredentialsStore } from "../credentials.ts";
import type { GlorpFleet } from "../fleet/types.ts";
import { pickModel } from "../model-picker.ts";
import { wrapGlorpModel } from "./wrappers.ts";
import { createRuntime } from "./session-runtime.ts";
import type { SubscriberState } from "./subscriber.ts";
import type { ExtensionCatalogue, GlorpHandle } from "./types.ts";

export interface SessionArgs {
  agent: IGloveRunnable;
  fleet: GlorpFleet;
  store: GlorpStore;
  credentials: CredentialsStore;
  bridge: Bridge;
  catalogue: ExtensionCatalogue;
  displayManager: DisplayManagerAdapter;
  labelListeners: Set<(label: string) => void>;
  sessionId: string;
  state: SubscriberState;
  refresh: { refreshStats(): Promise<void>; refreshTasks(): Promise<void>; refreshInbox(): Promise<void> };
  initialModel: ModelAdapter;
  initialLabel: string;
  swapModel(next: ModelAdapter, label: string): void;
}

/** Wraps a built agent with the public GlorpHandle surface. */
export function runSession(args: SessionArgs): GlorpHandle {
  let modelLabel = args.initialLabel;
  const runtime = createRuntime({
    agent: args.agent,
    store: args.store,
    bridge: args.bridge,
    sessionId: args.sessionId,
    state: args.state,
    refresh: args.refresh,
    model: args.initialModel,
  });

  const finalize = async () => {
    await args.store.flush();
    await args.fleet.stop();
  };

  return {
    agent: args.agent,
    fleet: args.fleet,
    store: args.store,
    credentials: args.credentials,
    sessionId: args.sessionId,
    extensions: args.catalogue,
    get modelLabel() { return modelLabel; },
    get title() { return runtime.title; },
    hydrateUi: () => runtime.hydrateUi(),
    onLabelChange(fn) {
      args.labelListeners.add(fn);
      return () => { args.labelListeners.delete(fn); };
    },
    resolveSlot(slotId, value) { resolveDisplay(args, slotId, value); },
    rejectSlot(slotId, reason) { rejectDisplay(args, slotId, reason); },
    resolvePermission(slotId, allow) { resolveDisplay(args, slotId, allow); },
    async clearPermission(toolName) { await args.store.setPermission(toolName, "unset"); },
    async swapProfile(profileId) {
      const next = await pickModel({ profileId, credentials: args.credentials });
      runtime.abortController?.abort();
      await runtime.cancelTitleGeneration();
      const wrapped = wrapGlorpModel(next.adapter);
      args.agent.setModel(wrapped);
      args.swapModel(wrapped, next.label);
      modelLabel = next.label;
      args.credentials.setActive(profileId);
      for (const fn of args.labelListeners) try { fn(next.label); } catch {}
    },
    send: (text) => runtime.send(text),
    abort: () => runtime.abort(),
    shutdown: () => runtime.shutdown(finalize),
  };
}

function resolveDisplay(args: SessionArgs, slotId: string, value: unknown): void {
  try { args.displayManager.resolve(slotId, value); } catch {}
  args.bridge.emit({ type: "display_slot_resolved", slotId });
}

function rejectDisplay(args: SessionArgs, slotId: string, reason?: string): void {
  try { args.displayManager.reject(slotId, reason); } catch {}
  args.bridge.emit({ type: "display_slot_resolved", slotId });
}
