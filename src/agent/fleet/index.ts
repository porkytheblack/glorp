import type { Context } from "glove-core/core";
import { spawnFleetJob } from "./spawner.ts";
import { SIGNAL_SCHEMAS } from "./signals.ts";
import type {
  FleetEvents,
  FleetJobConfig,
  FleetJobHandle,
  FleetJobInput,
  FleetJobResult,
  FleetSignalKind,
  GlorpFleet,
  InboxResolver,
} from "./types.ts";

const MAX_CONCURRENT = 6;

interface CreateFleetOptions {
  workspace: string;
  dataDir: string;
  provider?: string;
  model?: string;
}

/**
 * Build a fleet that dispatches every job to a fresh bun subprocess.
 *
 * Concurrency is bounded by a permit semaphore — overflow waits, never
 * spawns. Each running job is tracked so the UI can render a strip of
 * active workers, and so a `stop()` call can fan out SIGTERM via the per-
 * job abort controllers.
 */
export function createFleet(opts: CreateFleetOptions): GlorpFleet {
  const state = {
    resolver: null as InboxResolver | null,
    context: null as Context | null,
    stopping: false,
    inFlight: 0 as number,
    waiters: [] as Array<() => void>,
    active: new Map<string, { handle: FleetJobHandle; abort: AbortController }>(),
    listeners: new Set<FleetEvents>(),
    config: { workspace: opts.workspace, dataDir: opts.dataDir, provider: opts.provider, model: opts.model } satisfies FleetJobConfig,
  };

  const acquire = async (): Promise<void> => {
    if (state.inFlight < MAX_CONCURRENT) {
      state.inFlight++;
      return;
    }
    await new Promise<void>((r) => state.waiters.push(r));
    state.inFlight++;
  };
  const release = (): void => {
    state.inFlight--;
    const next = state.waiters.shift();
    if (next) next();
  };

  const resolve = async (itemId: string, response: string, status: "resolved" | "error") => {
    if (state.resolver) return state.resolver(itemId, response, status);
    if (state.context) {
      await state.context.updateInboxItem(itemId, {
        status: "resolved",
        response,
        resolved_at: new Date().toISOString(),
      });
    }
  };

  const fanout = (event: keyof FleetEvents, ...args: any[]) => {
    for (const l of state.listeners) {
      try { (l[event] as any)?.(...args); } catch {}
    }
  };

  async function runOne(kind: FleetSignalKind, input: FleetJobInput): Promise<string> {
    if (state.stopping) throw new Error("fleet is stopping");
    const parsed = SIGNAL_SCHEMAS[kind].inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid input for signal "${kind}": ${parsed.error.message}`);
    }
    const jobId = `run_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    const abort = new AbortController();
    const handle: FleetJobHandle = {
      jobId, kind, itemId: input.itemId, tag: input.tag, name: input.name, startedAt: Date.now(),
    };
    state.active.set(jobId, { handle, abort });
    fanout("onStart", handle);
    void (async () => {
      await acquire();
      let result: FleetJobResult = { ok: false, response: "(no result)", startedAt: handle.startedAt, endedAt: handle.startedAt };
      try {
        result = await spawnFleetJob({ kind, input, config: state.config, signal: abort.signal });
        const status = result.ok ? "resolved" : "error";
        await resolve(input.itemId, result.ok ? result.response : `[fleet error] ${result.response}`, status);
      } catch (err: any) {
        result = { ok: false, response: err?.message ?? String(err), startedAt: handle.startedAt, endedAt: Date.now() };
        await resolve(input.itemId, `[fleet error] ${result.response}`, "error");
      } finally {
        state.active.delete(jobId);
        release();
        fanout("onFinish", handle, result);
      }
    })();
    return jobId;
  }

  return {
    async start() {},
    async stop() {
      state.stopping = true;
      for (const { abort } of state.active.values()) abort.abort();
      const deadline = Date.now() + 3000;
      while (state.inFlight > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    dispatch: runOne,
    setInboxResolver(fn) { state.resolver = fn; },
    setContext(ctx) { state.context = ctx; },
    listActive() {
      return Array.from(state.active.values()).map((v) => v.handle);
    },
    subscribe(events) {
      state.listeners.add(events);
      return () => { state.listeners.delete(events); };
    },
  };
}

export type { GlorpFleet } from "./types.ts";
