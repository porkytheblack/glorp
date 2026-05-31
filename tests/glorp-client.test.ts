/**
 * Integration: the @porkytheblack/glorp-client kit driving a real auth-enabled
 * Station over HTTP. Exercises the non-LLM path — ping, workspace + session
 * create, status/result, abort, keys, and a 401 on a bad key.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startStation, type StationHandle } from "../src/station/server.ts";
import { loadStationConfig } from "../src/station/config.ts";
import { KeyStore } from "../src/station/auth/key-store.ts";
import { MemoryKeyStorage } from "../src/station/auth/memory-key-storage.ts";
import { createClient, GlorpRemoteError } from "../packages/glorp-client/src/index.ts";

const tmpDirs: string[] = [];
const stations: StationHandle[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "kit-test-"));
  tmpDirs.push(d);
  return d;
}

async function boot() {
  const storage = new MemoryKeyStorage();
  const { key } = await new KeyStore(storage).create("kit", ["admin"]);
  const station = await startStation(
    loadStationConfig({ hostname: "127.0.0.1", port: 0, dataDir: tmp(), auth: { enabled: true, keyStorage: storage } }),
  );
  stations.push(station);
  return { endpoint: `http://127.0.0.1:${station.port}`, key };
}

afterEach(async () => {
  for (const s of stations.splice(0)) await s.stop().catch(() => {});
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("glorp-client kit", () => {
  it("drives workspace + session lifecycle against an authed Station", async () => {
    const { endpoint, key } = await boot();
    const client = createClient({ endpoint, apiKey: key });

    expect(await client.ping()).toBe(true);

    const ws = await client.workspaces.create(tmp());
    expect(ws.id).toBeTruthy();

    const session = await client.sessions.createInWorkspace(ws.id, {});
    expect(session.workspace_id).toBe(ws.id);

    const got = await client.sessions.get(session.id);
    expect(got.id).toBe(session.id);

    const result = await client.sessions.result(session.id);
    expect(result.text).toBeNull();
    expect(["idle", "provisioning"]).toContain(result.status);

    const aborted = await client.sessions.abort(session.id);
    expect(aborted.aborted).toBe(true);

    const keys = await client.keys.list();
    expect(Array.isArray(keys)).toBe(true);
  });

  it("throws a typed GlorpRemoteError on a bad key", async () => {
    const { endpoint } = await boot();
    const client = createClient({ endpoint, apiKey: "glsk_wrong" });
    try {
      await client.sessions.list();
      throw new Error("expected a 401");
    } catch (err) {
      expect(err).toBeInstanceOf(GlorpRemoteError);
      expect((err as GlorpRemoteError).status).toBe(401);
    }
  });
});
