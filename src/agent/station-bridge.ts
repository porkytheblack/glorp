import { SignalRunner } from "station-signal";
import type { ModelAdapter, Context } from "glove-core/core";
import type { Run, SignalSubscriber } from "station-signal";
import { fileURLToPath } from "node:url";
import { editFanoutSignal, researchSignal, shellFanoutSignal } from "./fleet/signals.ts";
import type { FleetJobEvent } from "../shared/events.ts";
import type { FleetKind, FleetSignalInput } from "./fleet/types.ts";
import { parseRunInput, parseRunOutput, sleep, toFleetJob } from "./fleet/runner-utils.ts";

type InboxResolver = (itemId: string, response: string, status: "resolved" | "error") => Promise<void>;

export interface FleetModelConfig {
  provider?: string;
  model?: string;
  profileId?: string;
}

export interface GlorpFleet {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatch(kind: FleetKind, input: { itemId: string; tag: string; payload: string; name?: string }): Promise<string>;
  cancel(runId: string): Promise<boolean>;
  cancelAll(): Promise<void>;
  setInboxResolver(fn: InboxResolver): void;
  setContext(ctx: Context | null): void;
  setModelConfig(config: FleetModelConfig): void;
}

export async function createFleet(opts: {
  workspace: string;
  model: ModelAdapter;
  dataDir?: string;
  provider?: string;
  selectedModel?: string;
  profileId?: string;
  systemPromptForSubagents?: string;
  onJobUpdate?: (job: FleetJobEvent) => void;
}): Promise<GlorpFleet> {
  let inboxResolver: InboxResolver | null = null;
  let contextRef: Context | null = null;
  let modelConfig: FleetModelConfig = { provider: opts.provider, model: opts.selectedModel, profileId: opts.profileId };
  const active = new Map<string, FleetJobEvent>();
  const signalFile = fileURLToPath(new URL("./fleet/signals.ts", import.meta.url));
  const runner = new SignalRunner({ pollIntervalMs: 25, maxConcurrent: 6, subscribers: [fleetSubscriber()] });
  runner.registerSignal(researchSignal, signalFile).registerSignal(editFanoutSignal, signalFile).registerSignal(shellFanoutSignal, signalFile);

  let started = false;
  let stopping = false;
  let startPromise: Promise<void> | null = null;

  return {
    async start() {
      if (started) return;
      started = true;
      startPromise = runner.start().catch((err) => {
        if (!stopping) console.error("[glorp:fleet] Station runner failed:", err);
      });
      await Promise.resolve();
    },
    async stop() {
      if (stopping) return;
      stopping = true;
      await runner.stop({ graceful: true, timeoutMs: 300 });
      await Promise.race([startPromise ?? Promise.resolve(), sleep(500)]).catch(() => {});
    },
    async dispatch(kind, input) {
      if (stopping) throw new Error("fleet is stopping");
      return runner.triggerSignal(kind, { ...input, workspace: opts.workspace, dataDir: opts.dataDir, ...modelConfig } satisfies FleetSignalInput);
    },
    cancel(runId) { return runner.cancel(runId); },
    async cancelAll() { await Promise.all([...active.keys()].map((runId) => runner.cancel(runId))); },
    setInboxResolver(fn) { inboxResolver = fn; },
    setContext(ctx) { contextRef = ctx; },
    setModelConfig(config) { modelConfig = config; },
  };

  function fleetSubscriber(): SignalSubscriber {
    return {
      onRunDispatched({ run }) {
        const input = parseRunInput(run);
        if (!input) return;
        const job = toFleetJob(run, input, "running");
        active.set(run.id, job);
        opts.onJobUpdate?.(job);
      },
      async onRunCompleted({ run, output }) {
        const input = parseRunInput(run);
        const result = parseRunOutput(output);
        if (!input) return;
        const status = result?.status ?? "resolved";
        await resolve(input.itemId, result?.response ?? "(no response)", status);
        finish(run, input, status === "resolved" ? "resolved" : "error");
      },
      async onRunFailed({ run, error }) {
        const input = parseRunInput(run);
        if (!input) return;
        await resolve(input.itemId, `fleet failed: ${error ?? "unknown error"}`, "error");
        finish(run, input, "error");
      },
      async onRunCancelled({ run }) {
        const input = parseRunInput(run);
        if (!input) return;
        await resolve(input.itemId, "fleet job cancelled", "error");
        finish(run, input, "cancelled");
      },
    };
  }

  async function resolve(itemId: string, response: string, status: "resolved" | "error"): Promise<void> {
    if (inboxResolver) return inboxResolver(itemId, response, status);
    if (!contextRef) return;
    await contextRef.updateInboxItem(itemId, {
      status: "resolved",
      response,
      resolved_at: new Date().toISOString(),
    });
  }

  function finish(run: Run, input: FleetSignalInput, status: FleetJobEvent["status"]): void {
    const prior = active.get(run.id);
    const job = { ...(prior ?? toFleetJob(run, input, status)), status, endedAt: Date.now() };
    active.delete(run.id);
    opts.onJobUpdate?.(job);
  }
}
