/**
 * Discover a running Glorp server by reading its discovery file.
 * The server writes `<dataDir>/server.json` on startup; this module
 * reads it and verifies the process is still alive.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { ServerDiscovery } from "../protocol/envelope.ts";

/**
 * Read the server.json discovery file.
 * Returns null if the file is missing, unparseable, or the server
 * process is no longer running.
 */
export async function discoverServer(dataDir?: string): Promise<ServerDiscovery | null> {
  const dir = dataDir ?? path.join(os.homedir(), ".glorp");
  const filePath = path.join(dir, "server.json");

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  let info: ServerDiscovery;
  try {
    info = JSON.parse(raw) as ServerDiscovery;
  } catch {
    return null;
  }

  if (typeof info.port !== "number" || typeof info.pid !== "number") {
    return null;
  }

  // Verify the process is still running (signal 0 doesn't send a real signal).
  try {
    process.kill(info.pid, 0);
  } catch {
    return null;
  }

  return info;
}

/** Build a client URL from a discovery result. */
export function serverUrl(discovery: ServerDiscovery): string {
  return `http://127.0.0.1:${discovery.port}`;
}
