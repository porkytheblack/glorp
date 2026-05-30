import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { GlorpStore } from "../src/agent/store.ts";
import { resolveSessionPaths } from "../src/agent/session-paths.ts";
import { SessionManager } from "../src/station/manager.ts";
import { loadStationConfig } from "../src/station/config.ts";
import { isAllowedBrowserOrigin, startStation } from "../src/station/server.ts";

const tmpDirs: string[] = [];

function tmp(prefix = "station-fix-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

describe("Station snapshot rehydration", () => {
  it("rehydrates folder-layout snapshots written by current sessions", async () => {
    const dataDir = tmp();
    const workspace = path.join(dataDir, "ws");
    const paths = resolveSessionPaths(dataDir, "folder-snap");
    const store = new GlorpStore("folder-snap", dataDir, { workspace, filePath: paths.storeFile });
    await store.setTitle("Folder snapshot");
    await store.flush();

    const mgr = new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "workspaces"), permissionMode: "normal" });
    const listed = await mgr.list();
    expect(listed.find((s) => s.id === "folder-snap")?.loaded).toBe(false);

    const rehydrated = mgr.getOrRehydrate("folder-snap");
    expect(rehydrated?.workspace).toBe(workspace);
    await expect(mgr.create({ sessionId: "folder-snap" })).rejects.toThrow(/already exists/);
  });
});

describe("Station browser origin checks", () => {
  it("allows same-origin, loopback dev, and non-browser clients only", () => {
    const stationUrl = new URL("http://127.0.0.1:4271/sessions");
    expect(isAllowedBrowserOrigin(null, stationUrl)).toBe(true);
    expect(isAllowedBrowserOrigin("http://127.0.0.1:4271", stationUrl)).toBe(true);
    expect(isAllowedBrowserOrigin("http://localhost:5173", stationUrl)).toBe(true);
    expect(isAllowedBrowserOrigin("https://example.com", stationUrl)).toBe(false);
  });

  it("rejects cross-site REST requests before routing", async () => {
    const dataDir = tmp();
    const station = await startStation(loadStationConfig({ dataDir, port: await freePort(), hostname: "127.0.0.1" }));
    try {
      const response = await fetch(`http://127.0.0.1:${station.port}/sessions`, {
        headers: { origin: "https://example.com" },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await station.stop();
    }
  });
});
