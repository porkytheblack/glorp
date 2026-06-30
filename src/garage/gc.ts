/**
 * Idle-session garbage collector. A long-running Garage accumulates loaded
 * sessions whose agents have gone quiet — each pins a model adapter and any
 * sandbox child processes, which (under a per-namespace resource ceiling) starves
 * the next build. This sweeps every live namespace on an interval and unloads
 * sessions that have been idle past the configured TTL, freeing the host while
 * keeping the snapshot rehydratable. See `SessionManager.reapIdle`.
 */

import type { NamespaceRegistry } from "./namespace-registry.ts";
import type { GarageConfig } from "./config.ts";
import type { IdleSweepReport, IdleSkipEntry } from "./manager.ts";

/**
 * Start the idle-session GC. Returns a `stop()` that clears the timer. A
 * non-positive TTL disables the GC entirely (returns a no-op stop). The timer is
 * `unref`'d so it never keeps the process alive on its own.
 */
export function startIdleGc(registry: NamespaceRegistry, config: GarageConfig): () => void {
  const ttl = config.idleSessionTtlMs;
  if (ttl <= 0) {
    console.log("[glorp-garage] idle-session GC: disabled (idleSessionTtlMs=0)");
    return () => {};
  }
  console.log(
    `[glorp-garage] idle-session GC: on (ttl ${Math.round(ttl / 1000)}s, every ${Math.round(config.gcIntervalMs / 1000)}s)`,
  );
  const timer = setInterval(() => {
    void sweep(registry, ttl);
  }, config.gcIntervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * One pass: reap idle sessions in every currently-built namespace bundle, and
 * log per-session WHY each loaded session was kept (busy / watched /
 * awaiting-input / fresh) plus a one-line summary — so an operator can see
 * exactly what is pinning agent hosts when "GC isn't reclaiming my sessions".
 */
async function sweep(registry: NamespaceRegistry, ttl: number): Promise<void> {
  for (const bundle of registry.liveBundles()) {
    try {
      const report = await bundle.manager.reapIdleReport(ttl);
      logSweep(bundle.ns.id, report, ttl);
    } catch (err) {
      console.error(`[glorp-garage] gc sweep failed for ${bundle.ns.id}:`, err);
    }
  }
}

/**
 * Operator log for one namespace's sweep. Silent when nothing is loaded (no
 * host to reclaim), so an idle garage doesn't print an empty line every
 * interval; otherwise a summary line plus one line per kept session.
 */
function logSweep(nsId: string, report: IdleSweepReport, ttl: number): void {
  if (report.scanned === 0) return;
  const tally = tallyReasons(report.skipped);
  console.log(
    `[glorp-garage] gc: ns=${nsId} scanned=${report.scanned} ` +
      `reaped=${report.reaped.length} kept=${report.skipped.length}` +
      (tally ? ` (${tally})` : ""),
  );
  for (const s of report.skipped) {
    console.log(`[glorp-garage] gc:   keep ${s.id}: ${describeSkip(s, ttl)}`);
  }
}

/** "watched=2, fresh=1" — counts of each keep reason in a stable order. */
function tallyReasons(skipped: IdleSkipEntry[]): string {
  const order: IdleSkipEntry["reason"][] = ["busy", "watched", "awaiting-input", "fresh"];
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return order.filter((r) => counts.has(r)).map((r) => `${r}=${counts.get(r)}`).join(", ");
}

/** Human-readable reason one session kept its agent host this sweep. */
function describeSkip(s: IdleSkipEntry, ttl: number): string {
  switch (s.reason) {
    case "busy":
      return `busy — a turn is running (idle ${s.idleSec}s)`;
    case "watched":
      return `watched — ${s.clients} connected client${s.clients === 1 ? "" : "s"} (idle ${s.idleSec}s)`;
    case "awaiting-input":
      return `awaiting-input — a prompt/permission is open (idle ${s.idleSec}s)`;
    case "fresh":
      return `fresh — idle ${s.idleSec}s < ttl ${Math.round(ttl / 1000)}s`;
  }
}
