/**
 * Integration: the @porkytheblack/glorp-client kit driving a real auth-enabled
 * Garage over HTTP. Exercises the non-LLM path — ping, workspace + session
 * create, status/result, abort, keys, and a 401 on a bad key.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage, type GarageHandle } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";
import { KeyStore } from "../src/garage/auth/key-store.ts";
import { MemoryKeyStorage } from "../src/garage/auth/memory-key-storage.ts";
import { createClient, GlorpRemoteError } from "../packages/glorp-client/src/index.ts";

const tmpDirs: string[] = [];
const garages: GarageHandle[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "kit-test-"));
  tmpDirs.push(d);
  return d;
}

async function boot() {
  const storage = new MemoryKeyStorage();
  const { key } = await new KeyStore(storage).create("kit", ["admin"]);
  const garage = await startGarage(
    loadGarageConfig({ hostname: "127.0.0.1", port: 0, dataDir: tmp(), auth: { enabled: true, keyStorage: storage } }),
  );
  garages.push(garage);
  return { endpoint: `http://127.0.0.1:${garage.port}`, key };
}

afterEach(async () => {
  for (const s of garages.splice(0)) await s.stop().catch(() => {});
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("glorp-client kit", () => {
  it("drives workspace + session lifecycle against an authed Garage", async () => {
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

  it("provisions namespaces, mints tenant keys, and isolates them via the SDK", async () => {
    const { endpoint, key } = await boot();
    const admin = createClient({ endpoint, apiKey: key });

    // Admin control plane: provision + mint a namespace-bound key.
    const ns = await admin.namespaces.create("Acme");
    expect(ns.id).toBe("ns_acme");
    expect(ns.is_default).toBe(false);
    const minted = await admin.namespaces.createKey(ns.id, "acme-bot");
    expect(minted.namespace).toBe("ns_acme");
    expect(minted.scopes).not.toContain("admin");

    // Tenant client (its key is namespace-bound — no header needed).
    const tenant = createClient({ endpoint, apiKey: minted.key });
    const s = await tenant.sessions.create({ permissionMode: "bypass" });
    expect((await tenant.sessions.list()).sessions.map((x) => x.id)).toContain(s.id);
    // Default namespace (admin, no namespace) doesn't see the tenant's session.
    expect((await admin.sessions.list()).sessions.map((x) => x.id)).not.toContain(s.id);
    // Admin proxies into the namespace via forNamespace() — without mutating the
    // parent admin client, which stays on the default namespace.
    expect((await admin.forNamespace("ns_acme").sessions.list()).sessions.map((x) => x.id)).toContain(s.id);
    expect((await admin.sessions.list()).sessions.map((x) => x.id)).not.toContain(s.id);

    // Deprovision wipes it and revokes the key.
    const del = await admin.namespaces.delete(ns.id, true);
    expect(del.deleted).toBe(true);
    try {
      await tenant.sessions.list();
      throw new Error("expected 401 after deprovision");
    } catch (err) {
      expect((err as GlorpRemoteError).status).toBe(401);
    }
  });

  it("rejects a blank namespace at config time", async () => {
    const { endpoint, key } = await boot();
    expect(() => createClient({ endpoint, apiKey: key, namespace: "   " })).toThrow(/namespace/);
    // A valid namespace is trimmed and accepted.
    expect(createClient({ endpoint, apiKey: key, namespace: " ns_acme " }).config.namespace).toBe("ns_acme");
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
