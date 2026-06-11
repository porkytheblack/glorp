/**
 * Glorp Garage — a long-running multi-session runtime. A single Bun.serve()
 * instance is driven by a Hono app (`buildGarageApp`): a REST API for managing
 * sessions and a WebSocket endpoint (`/sessions/:id/events`) for streaming each
 * session's events.
 *
 * Composed from the agent layer (`buildGlorp`) via the SessionManager — this
 * is intentionally separate from the single-session `src/server/`.
 */

import * as path from "node:path";
import type { SessionManager } from "./manager.ts";
import { createGarageRouter } from "./router.ts";
import { CredentialsStore } from "../agent/credentials.ts";
import { credentialStorageFromEnv } from "../agent/credential-storage.ts";
import { TemplateStore } from "./templates/store.ts";
import { NamespaceStore, DEFAULT_NAMESPACE_ID } from "./namespace-store.ts";
import { NamespaceRegistry } from "./namespace-registry.ts";
import { StorageConfigStore } from "./storage/config-store.ts";
import { namespaceControlRoutes } from "./routes/namespaces.ts";
import { KeyStore } from "./auth/key-store.ts";
import { adminAuthConfigured } from "./auth/admin.ts";
import { authRequired, type GarageConfig } from "./config.ts";
import { startIdleGc } from "./gc.ts";
import { buildGarageApp } from "./http-app.ts";
export { isAllowedBrowserOrigin } from "./cors.ts";

export interface GarageHandle {
  port: number;
  manager: SessionManager;
  stop: () => Promise<void>;
}

export async function startGarage(config: GarageConfig): Promise<GarageHandle> {
  const garageCredentials = new CredentialsStore(credentialStorageFromEnv(config.dataDir));
  const templates = new TemplateStore(config.templatesDir);
  const namespaceStore = new NamespaceStore(config.dataDir, config.workspaceRoot);
  const storageConfig = new StorageConfigStore(config.dataDir);
  const registry = new NamespaceRegistry(namespaceStore, config, templates, garageCredentials);
  const startedAt = Date.now();
  const keyStore = new KeyStore(config.auth?.keyStorage ?? path.join(config.dataDir, "glorp-keys.json"));
  const authOn = authRequired(config);
  const namespaceCtl = namespaceControlRoutes(namespaceStore, registry, keyStore, config);
  const router = createGarageRouter(templates, keyStore, namespaceCtl, storageConfig);

  const { app, websocket } = buildGarageApp({ registry, router, keyStore, authOn, startedAt });

  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    fetch: app.fetch,
    websocket,
  });

  const port = server.port ?? config.port;
  // Reflect the actually-bound port back so ws_urls are correct (matters when
  // the caller passed port 0 to get an ephemeral port, e.g. in tests).
  config.port = port;
  console.log(`[glorp-garage] listening on ${config.hostname}:${port} (dataDir: ${config.dataDir})`);
  if (authOn) {
    const count = (await keyStore.list().catch(() => [])).length;
    console.log(`[glorp-garage] API-key auth: REQUIRED (${count} key${count === 1 ? "" : "s"})`);
    if (count === 0) {
      console.warn("[glorp-garage]   No API keys yet — run `glorp garage keys add <name>` to create one.");
    }
  } else {
    console.log("[glorp-garage] API-key auth: off (loopback). Bind a non-loopback host or set auth to enable.");
  }

  if (adminAuthConfigured()) {
    console.log("[glorp-garage] admin dashboard login: enabled (GARAGE_ADMIN_USER)");
    if (!process.env.GARAGE_JWT_SECRET) {
      console.warn(
        "[glorp-garage]   GARAGE_JWT_SECRET is unset — signing JWTs with a secret derived from the admin password. " +
          "Set GARAGE_JWT_SECRET to a strong random value in production.",
      );
    }
  }

  const stopGc = startIdleGc(registry, config);

  return {
    port,
    // Back-compat handle: the default namespace's manager.
    manager: registry.resolve(DEFAULT_NAMESPACE_ID).manager,
    async stop() {
      stopGc();
      for (const bundle of registry.liveBundles()) await bundle.manager.shutdownAll();
      await keyStore.close().catch(() => {});
      server.stop();
      console.log("[glorp-garage] stopped");
    },
  };
}
