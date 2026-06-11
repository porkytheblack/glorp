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

/** One pass: reap idle sessions in every currently-built namespace bundle. */
async function sweep(registry: NamespaceRegistry, ttl: number): Promise<void> {
  for (const bundle of registry.liveBundles()) {
    try {
      const reaped = await bundle.manager.reapIdle(ttl);
      if (reaped.length > 0) {
        console.log(
          `[glorp-garage] gc: unloaded ${reaped.length} idle session(s) in ${bundle.ns.id}`,
        );
      }
    } catch (err) {
      console.error(`[glorp-garage] gc sweep failed for ${bundle.ns.id}:`, err);
    }
  }
}
