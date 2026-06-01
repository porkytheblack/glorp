/**
 * @porkytheblack/glorp-client — a typed client for driving a remote Glorp
 * Station: create workspaces, run agents, and poll/stream results over an
 * API-key-secured HTTP/WS API.
 *
 *   import { configure, run } from "@porkytheblack/glorp-client";
 *   configure({ endpoint: "https://glorp.example.com", apiKey: "glsk_…" });
 *   const handle = await run({ workspace: "/srv/project", prompt: "Fix the build" });
 *   const { text } = await handle.result();
 */

import { resolveConfig } from "./config.js";
import { runWith, type RunHandle, type RunOptions } from "./run.js";
import { streamSessionWith, type SessionStream } from "./ws.js";
import type { BridgeEvent } from "./contract.js";

export { configure, resolveConfig, type GlorpConfig } from "./config.js";
export { createClient, type GlorpClient } from "./client.js";
export { GlorpRemoteError } from "./errors.js";
export { type RunOptions, type RunHandle, type ResultOptions } from "./run.js";
export { type SessionStream } from "./ws.js";
export * from "./contract.js";

/** Run a prompt using the default config (from `configure()` or env vars). */
export function run(opts: RunOptions): Promise<RunHandle> {
  return runWith(resolveConfig(), opts);
}

/** Stream a session's events using the default config. */
export function streamSession(id: string, onEvent?: (event: BridgeEvent) => void): SessionStream {
  return streamSessionWith(resolveConfig(), id, onEvent);
}
