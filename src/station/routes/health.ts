/** Station health check. */

import type { SessionManager } from "../manager.ts";
import { GLORP_VERSION } from "../../shared/version.ts";
import { json } from "../respond.ts";

export function healthRoute(manager: SessionManager, startedAt: number): Response {
  return json({
    status: "ok",
    version: GLORP_VERSION,
    uptime_ms: Date.now() - startedAt,
    live_sessions: manager.liveCount,
  });
}
