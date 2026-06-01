/**
 * `glorp station` — start the multi-session Station runtime and keep the
 * process alive until interrupted. State is flushed on graceful shutdown.
 */

import type { CliArgs } from "./cli-args.ts";
import { loadStationConfig } from "./station/config.ts";
import { startStation } from "./station/server.ts";

export async function runStation(args: CliArgs): Promise<void> {
  const config = loadStationConfig({
    port: args.port,
    hostname: args.host,
    dataDir: args.dataDir,
    workspaceRoot: args.workspaceRoot,
    provider: args.provider,
    model: args.model,
    permissionMode: args.permissionMode,
  });

  const station = await startStation(config);

  // Keep Station alive through a single session's failure. A rogue agent's
  // unhandled rejection (or a throw in detached async work) should be logged,
  // not fatal — the session's own lifecycle moves it to `error` separately.
  process.on("unhandledRejection", (reason) => {
    console.error("[glorp-station] unhandled rejection (process kept alive):", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[glorp-station] uncaught exception (process kept alive):", err);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[glorp-station] ${signal} received — flushing sessions…`);
    await station.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Keep the event loop alive indefinitely.
  await new Promise<void>(() => {});
}
