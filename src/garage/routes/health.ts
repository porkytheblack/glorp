/** Garage health check. */

import type { NamespaceRegistry } from "../namespace-registry.ts";
import { GLORP_VERSION } from "../../shared/version.ts";
import { json } from "../respond.ts";

export function healthRoute(registry: NamespaceRegistry, startedAt: number): Response {
  const liveSessions = registry.liveBundles().reduce((n, b) => n + b.manager.liveCount, 0);
  return json({
    status: "ok",
    version: GLORP_VERSION,
    uptime_ms: Date.now() - startedAt,
    live_sessions: liveSessions,
  });
}
