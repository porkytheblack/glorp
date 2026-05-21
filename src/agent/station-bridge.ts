import { signal, z } from "station-signal";
import type { AnySignal } from "station-signal";
import { spawn } from "node:child_process";
import type { Context, ModelAdapter } from "glove-core/core";
import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import { MemoryStore } from "./memory-store-shim.ts";

/**
 * Resolves a posted-to-Glorp's-inbox item once the fleet job finishes.
 * We pass it in via a per-run resolver so the signal handler isn't tied
 * to the global agent context directly (cleaner shutdown, easier tests).
 */
type InboxResolver = (
  itemId: string,
  response: string,
  status: "resolved" | "error",
) => Promise<void>;

export interface GlorpFleet {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatch(
    kind: "research" | "edit-fanout" | "shell-fanout",
    input: { itemId: string; tag: string; payload: string; name?: string },
  ): Promise<string>;
  setInboxResolver(fn: InboxResolver): void;
  setContext(ctx: Context | null): void;
}

/**
 * The Station fleet is built in-process. We use the MemoryAdapter so we
 * don't need to deal with SQLite native deps when compiling the single
 * binary. The fleet runner spins up the SignalRunner with no signalsDir
 * (we register signals programmatically via registerSignal).
 */
export async function createFleet(opts: {
  workspace: string;
  model: ModelAdapter;
  systemPromptForSubagents: string;
}): Promise<GlorpFleet> {
  let inboxResolver: InboxResolver | null = null;
  let contextRef: Context | null = null;

  const resolve = async (
    itemId: string,
    response: string,
    status: "resolved" | "error",
  ): Promise<void> => {
    if (inboxResolver) {
      await inboxResolver(itemId, response, status);
      return;
    }
    if (contextRef) {
      await contextRef.updateInboxItem(itemId, {
        status: "resolved",
        response,
        resolved_at: new Date().toISOString(),
      });
    }
  };

  // --- Research signal -----------------------------------------------
  // Spawns a tiny child Glove with the same model, isolated store, no
  // tools beyond web_fetch. Returns a short answer.
  const researchSignal = signal("research")
    .input(
      z.object({
        itemId: z.string(),
        tag: z.string(),
        payload: z.string(),
        name: z.string().optional(),
      }),
    )
    .timeout(120_000)
    .retries(1)
    .run(async (input): Promise<void> => {
      try {
        const child = new Glove({
          store: new MemoryStore(`fleet_research_${input.itemId}`),
          model: opts.model,
          displayManager: new Displaymanager(),
          serverMode: true,
          systemPrompt:
            "You are a tightly-scoped research subagent. Answer the question in 3-6 sentences. " +
            "Cite filenames or URLs you consulted. If you cannot answer with confidence, say so.",
          compaction_config: {
            compaction_instructions: "Keep research findings, drop chatter.",
            max_turns: 8,
          },
        }).build();
        const result = await child.processRequest(input.payload);
        const text =
          "messages" in result
            ? result.messages.at(-1)?.text ?? "(no response)"
            : (result as { text?: string }).text ?? "(no response)";
        await resolve(input.itemId, text, "resolved");
      } catch (err: any) {
        await resolve(input.itemId, `research failed: ${err?.message ?? err}`, "error");
      }
    });

  // --- Edit-fanout signal --------------------------------------------
  // Runs a shell command (typically a small edit script) in the workspace.
  const editFanoutSignal = signal("edit-fanout")
    .input(
      z.object({
        itemId: z.string(),
        tag: z.string(),
        payload: z.string(),
        name: z.string().optional(),
      }),
    )
    .timeout(60_000)
    .retries(0)
    .run(async (input): Promise<void> => {
      const result = await runShell(input.payload, opts.workspace, 60_000);
      const summary =
        `exit=${result.exitCode}\n` +
        (result.stdout ? `stdout:\n${result.stdout.slice(0, 4000)}\n` : "") +
        (result.stderr ? `stderr:\n${result.stderr.slice(0, 2000)}` : "");
      await resolve(
        input.itemId,
        summary,
        result.exitCode === 0 ? "resolved" : "error",
      );
    });

  // --- Shell-fanout signal -------------------------------------------
  const shellFanoutSignal = signal("shell-fanout")
    .input(
      z.object({
        itemId: z.string(),
        tag: z.string(),
        payload: z.string(),
        name: z.string().optional(),
      }),
    )
    .timeout(120_000)
    .retries(0)
    .run(async (input): Promise<void> => {
      const result = await runShell(input.payload, opts.workspace, 120_000);
      const summary =
        `exit=${result.exitCode}\n` +
        (result.stdout ? `stdout:\n${result.stdout.slice(0, 4000)}\n` : "") +
        (result.stderr ? `stderr:\n${result.stderr.slice(0, 2000)}` : "");
      await resolve(
        input.itemId,
        summary,
        result.exitCode === 0 ? "resolved" : "error",
      );
    });

  // Tiny in-process executor that runs Station-defined signals directly
  // instead of forking child processes. We keep Station's signal builder
  // so we get Zod validation + the same authoring shape, but we run the
  // handlers in-band — fits our single-binary model.
  const signals = new Map<string, AnySignal>();
  signals.set("research", researchSignal as unknown as AnySignal);
  signals.set("edit-fanout", editFanoutSignal as unknown as AnySignal);
  signals.set("shell-fanout", shellFanoutSignal as unknown as AnySignal);

  // Concurrency limiter: a permit semaphore. Acquire blocks until a slot
  // is available; release wakes the next waiter. try/finally guarantees
  // permits are returned even if a handler throws synchronously or the
  // input fails validation.
  const MAX_CONCURRENT = 6;
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (inFlight < MAX_CONCURRENT) {
      inFlight++;
      return;
    }
    await new Promise<void>((r) => waiters.push(r));
    inFlight++;
  };
  const release = (): void => {
    inFlight--;
    const next = waiters.shift();
    if (next) next();
  };

  // `fleetChildren` is supplied per-call so the per-fleet child set is
  // threaded into runShell via a Symbol-keyed slot on globalThis. Cleaner
  // would be passing it through the signal handler, but Station's
  // signal-builder API doesn't accept extra args — we keep the boundary
  // narrow by stashing it just for the duration of the runOne call.
  const runOne = async (
    name: string,
    input: unknown,
    fleetChildren: Set<ReturnType<typeof spawn>>,
  ): Promise<string> => {
    const sig = signals.get(name);
    if (!sig) throw new Error(`Unknown signal: ${name}`);
    const runId = `run_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    // Validate eagerly so caller sees errors. handler() runs in the
    // background — its errors are logged but don't reject `runOne`.
    const parsed = sig.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid input for signal "${name}": ${parsed.error.message}`);
    }
    void (async () => {
      await acquire();
      try {
        currentChildSet = fleetChildren;
        if (sig.handler) await sig.handler(parsed.data);
      } catch (err) {
        if (process.env.GLORP_DEBUG) console.error(`[fleet:${name}] handler threw:`, err);
      } finally {
        currentChildSet = null;
        release();
      }
    })();
    return runId;
  };

  // Per-fleet shutdown state. Tracked here (not module-level) so multiple
  // fleets can coexist in the same process — important for the test suite
  // and for any caller that constructs a fresh fleet after stopping the
  // previous one.
  let stopping = false;
  const fleetChildren = new Set<ReturnType<typeof spawn>>();

  return {
    async start() {
      // No-op for the in-process executor.
    },
    async stop() {
      // Kill every active child first so long-running shell jobs don't
      // outlive the agent; then wait briefly for the close handlers to
      // record results into the inbox.
      stopping = true;
      for (const child of fleetChildren) {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
      setTimeout(() => {
        for (const child of fleetChildren) {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      }, 1000);
      const deadline = Date.now() + 3000;
      while (inFlight > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    async dispatch(kind, input) {
      if (stopping) throw new Error("fleet is stopping");
      return runOne(kind, input, fleetChildren);
    },
    setInboxResolver(fn) {
      inboxResolver = fn;
    },
    setContext(ctx) {
      contextRef = ctx;
    },
  };
}

/**
 * Slot used by `runShell` to register spawned children with the currently-
 * dispatching fleet's child set. Set by `runOne` immediately before invoking
 * the signal handler and cleared in the finally block. Lets `fleet.stop()`
 * find and kill children without forcing every signal handler to plumb the
 * fleet reference through its input schema.
 */
let currentChildSet: Set<ReturnType<typeof spawn>> | null = null;

async function runShell(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const childSet = currentChildSet;
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", cmd], { cwd, env: process.env });
    childSet?.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf-8")));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString("utf-8")));
    let sigkillTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      // Escalate to SIGKILL if SIGTERM is trapped by the child.
      sigkillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 1500);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      childSet?.delete(child);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.on("error", () => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      childSet?.delete(child);
      resolve({ exitCode: -1, stdout, stderr: stderr + "\n[spawn failed]" });
    });
  });
}
