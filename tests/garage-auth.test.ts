/**
 * API-key auth: the KeyStore crypto, file persistence, and the server-side
 * enforcement (Bearer + ?api_key=, /health open, admin scope on /keys) plus
 * the /api/v1 versioned prefix parity.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage, type GarageHandle } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";
import { KeyStore } from "../src/garage/auth/key-store.ts";
import { MemoryKeyStorage } from "../src/garage/auth/memory-key-storage.ts";
import { FileKeyStorage } from "../src/garage/auth/file-key-storage.ts";

const tmpDirs: string[] = [];
const garages: GarageHandle[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const s of garages.splice(0)) await s.stop().catch(() => {});
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("KeyStore", () => {
  it("generates a glsk_ key, verifies it, and never returns the hash", async () => {
    const ks = new KeyStore(new MemoryKeyStorage());
    const { key, record } = await ks.create("ci", ["admin"]);
    expect(key.startsWith("glsk_")).toBe(true);
    expect(record.keyPrefix).toBe(key.slice(0, 12));
    expect(await ks.verify(key)).not.toBeNull();
    expect(await ks.verify("glsk_wrong")).toBeNull();
    const list = await ks.list();
    expect(list[0]).not.toHaveProperty("keyHash");
    expect(list[0]!.scopes).toEqual(["admin"]);
  });

  it("revokes and rejects expired keys", async () => {
    const storage = new MemoryKeyStorage();
    const ks = new KeyStore(storage);
    const { key, record } = await ks.create("ci");
    expect(await ks.revoke(record.id)).toBe(true);
    expect(await ks.verify(key)).toBeNull();

    const { key: key2, record: r2 } = await ks.create("ci2");
    storage.insert({ ...r2, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await ks.verify(key2)).toBeNull();
  });

  it("FileKeyStorage persists across instances", async () => {
    const file = path.join(tmp(), "glorp-keys.json");
    const a = new KeyStore(new FileKeyStorage(file));
    const { key } = await a.create("persisted");
    const b = new KeyStore(new FileKeyStorage(file));
    expect(await b.verify(key)).not.toBeNull();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("server auth enforcement", () => {
  async function startAuthed(scopes: string[] = ["admin"]) {
    const storage = new MemoryKeyStorage();
    const { key } = await new KeyStore(storage).create("ci", scopes);
    const config = loadGarageConfig({
      hostname: "127.0.0.1",
      port: 0,
      dataDir: tmp(),
      auth: { enabled: true, keyStorage: storage },
    });
    const garage = await startGarage(config);
    garages.push(garage);
    return { base: `http://127.0.0.1:${garage.port}`, key };
  }

  it("leaves /health open but requires a key elsewhere", async () => {
    const { base, key } = await startAuthed();
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/sessions`)).status).toBe(401);
    expect((await fetch(`${base}/sessions`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);
    expect((await fetch(`${base}/sessions?api_key=${key}`)).status).toBe(200);
    expect((await fetch(`${base}/sessions`, { headers: { authorization: "Bearer glsk_nope" } })).status).toBe(401);
  });

  it("enforces the admin scope on /keys", async () => {
    const { base, key } = await startAuthed(["read"]);
    // A read-only key can reach normal routes but not key management.
    expect((await fetch(`${base}/sessions`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);
    expect(
      (await fetch(`${base}/keys`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: "{}" })).status,
    ).toBe(403);
  });

  it("creates/lists/revokes keys over REST with the {data} envelope", async () => {
    const { base, key } = await startAuthed();
    const hdr = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    const created = await fetch(`${base}/keys`, { method: "POST", headers: hdr, body: JSON.stringify({ name: "worker", scopes: ["run"] }) });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string; key: string } };
    expect(body.data.key.startsWith("glsk_")).toBe(true);
    const listed = (await (await fetch(`${base}/keys`, { headers: hdr })).json()) as { data: unknown[] };
    expect(listed.data.length).toBeGreaterThanOrEqual(2);
    expect((await fetch(`${base}/keys/${body.data.id}`, { method: "DELETE", headers: hdr })).status).toBe(200);
  });

  it("serves the same surface under /api/v1", async () => {
    const { base, key } = await startAuthed();
    expect((await fetch(`${base}/api/v1/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/sessions`)).status).toBe(401);
    expect((await fetch(`${base}/api/v1/sessions`, { headers: { authorization: `Bearer ${key}` } })).status).toBe(200);
  });

  it("is open with no key on a loopback bind (auto default)", async () => {
    const config = loadGarageConfig({ hostname: "127.0.0.1", port: 0, dataDir: tmp() });
    const garage = await startGarage(config);
    garages.push(garage);
    expect((await fetch(`http://127.0.0.1:${garage.port}/sessions`)).status).toBe(200);
  });
});
