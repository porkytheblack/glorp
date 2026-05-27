/**
 * Server discovery file — written on startup, removed on shutdown.
 * Clients read `<dataDir>/server.json` to find a running server.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ServerDiscovery } from "../protocol/envelope.ts";

export async function writeDiscovery(
  dataDir: string,
  info: ServerDiscovery,
): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, "server.json");
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(info, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

export async function removeDiscovery(dataDir: string): Promise<void> {
  const filePath = path.join(dataDir, "server.json");
  await fs.unlink(filePath).catch(() => {});
}

export async function readDiscovery(
  dataDir: string,
): Promise<ServerDiscovery | null> {
  try {
    const raw = await fs.readFile(path.join(dataDir, "server.json"), "utf-8");
    const parsed = JSON.parse(raw) as ServerDiscovery;
    if (typeof parsed.port !== "number" || typeof parsed.pid !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
