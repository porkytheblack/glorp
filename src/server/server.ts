/**
 * Main Glorp server — HTTP + WebSocket on a single Bun.serve() instance driven
 * by a Hono app (`buildServerApp`). REST is at /api/v1/*, the WebSocket upgrade
 * at /api/v1/sessions/:id/ws. Binds to 127.0.0.1 only (dev tool).
 */

import { SessionPool } from "./session-pool.ts";
import { Broadcaster } from "./broadcast.ts";
import { createRouter } from "./router.ts";
import { buildServerApp } from "./http-app.ts";
import { writeDiscovery, removeDiscovery } from "./discovery.ts";
import { getBridge } from "../shared/bridge.ts";
import { DEFAULT_PORT } from "../protocol/envelope.ts";
import { GLORP_VERSION } from "../shared/version.ts";
import { CredentialsStore } from "../agent/credentials.ts";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";

export interface ServerConfig {
  workspace: string;
  dataDir: string;
  port?: number;
  token?: string;
  provider?: string;
  model?: string;
  permissionMode?: PermissionMode;
}

export async function startServer(
  config: ServerConfig,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const port = config.port ?? DEFAULT_PORT;
  const pool = new SessionPool(config.workspace, config.dataDir, config.provider, config.model, config.permissionMode);
  const broadcaster = new Broadcaster();
  const startedAt = Date.now();
  const credentials = new CredentialsStore(config.dataDir);
  const router = createRouter(
    pool,
    { workspace: config.workspace, dataDir: config.dataDir, port, startedAt },
    credentials,
  );

  // Relay every Bridge event to all connected WebSocket clients.
  const unsubscribe = getBridge().subscribe((event) => broadcaster.broadcast(event));

  const { app, websocket } = buildServerApp({
    pool,
    broadcaster,
    router,
    workspace: config.workspace,
    token: config.token,
  });

  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch, websocket });
  const actualPort = server.port ?? port;

  await writeDiscovery(config.dataDir, {
    port: actualPort,
    pid: process.pid,
    workspace: config.workspace,
    version: GLORP_VERSION,
    startedAt: new Date(startedAt).toISOString(),
  });

  console.log(`[glorp-server] listening on 127.0.0.1:${actualPort} (workspace: ${config.workspace})`);

  return {
    port: actualPort,
    async stop() {
      unsubscribe();
      await pool.shutdownAll();
      server.stop();
      await removeDiscovery(config.dataDir);
      console.log("[glorp-server] stopped");
    },
  };
}
