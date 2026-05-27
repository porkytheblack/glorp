/**
 * Public API surface for the Glorp server module.
 */

export { startServer, type ServerConfig } from "./server.ts";
export { readDiscovery } from "./discovery.ts";
export type { ActiveSession } from "./session-pool.ts";
