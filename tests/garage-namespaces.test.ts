/**
 * Multi-tenancy: the NamespaceStore primitive, namespace-aware auth resolution,
 * the per-namespace credentials fallback, and the end-to-end HTTP surface
 * (isolation, admin proxy, tenant authz, provisioning + deprovisioning).
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage, type GarageHandle } from "../src/garage/server.ts";
import { loadGarageConfig, type GarageConfig } from "../src/garage/config.ts";
import { KeyStore } from "../src/garage/auth/key-store.ts";
import { MemoryKeyStorage } from "../src/garage/auth/memory-key-storage.ts";
import {
  NamespaceStore,
  NamespaceError,
  DEFAULT_NAMESPACE_ID,
  slugify,
} from "../src/garage/namespace-store.ts";
import { selectNamespaceId, NamespaceForbiddenError } from "../src/garage/auth/middleware.ts";
import { NamespaceCredentialsStore } from "../src/garage/credentials.ts";
import { CredentialsStore } from "../src/agent/credentials.ts";
import type { ApiKey } from "../src/garage/auth/types.ts";

const tmpDirs: string[] = [];
const garages: GarageHandle[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ns-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const s of garages.splice(0)) await s.stop().catch(() => {});
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function key(scopes: string[], namespace: string | null): ApiKey {
  return {
    id: "k", name: "k", keyHash: "h", keyPrefix: "glsk_x", scopes,
    createdAt: "", lastUsed: null, expiresAt: null, revoked: false, namespace,
  };
}

describe("NamespaceStore", () => {
  it("synthesizes a default namespace mapped to the legacy roots", () => {
    const dataDir = tmp();
    const store = new NamespaceStore(dataDir, path.join(dataDir, "ws"));
    const def = store.get(DEFAULT_NAMESPACE_ID)!;
    expect(def.dataDir).toBe(dataDir);
    expect(def.workspaceRoot).toBe(path.join(dataDir, "ws"));
    expect(store.isDefault(def.id)).toBe(true);
    // No namespaces.json is written just for the synthesized default.
    expect(fs.existsSync(path.join(dataDir, "namespaces.json"))).toBe(false);
  });

  it("creates tenant namespaces under namespaces/<id> and persists them", () => {
    const dataDir = tmp();
    const wsRoot = path.join(dataDir, "ws");
    const store = new NamespaceStore(dataDir, wsRoot);
    const ns = store.create({ name: "Acme Corp" });
    expect(ns.id).toBe("ns_acme-corp");
    expect(ns.dataDir).toBe(path.join(dataDir, "namespaces", "ns_acme-corp"));
    expect(ns.workspaceRoot).toBe(path.join(wsRoot, "ns_acme-corp"));

    const reloaded = new NamespaceStore(dataDir, wsRoot);
    expect(reloaded.get("ns_acme-corp")?.name).toBe("Acme Corp");
    expect(reloaded.list().map((n) => n.id)).toEqual([DEFAULT_NAMESPACE_ID, "ns_acme-corp"]);
  });

  it("suffixes colliding slugs and refuses to delete default", () => {
    const store = new NamespaceStore(tmp(), tmp());
    const a = store.create({ name: "team" });
    const b = store.create({ name: "team" });
    expect(a.id).toBe("ns_team");
    expect(b.id).toBe("ns_team-2");
    expect(() => store.delete(DEFAULT_NAMESPACE_ID)).toThrow(NamespaceError);
    expect(store.delete("ns_team")).toBe(true);
  });

  it("rejects names that don't yield a slug", () => {
    const store = new NamespaceStore(tmp(), tmp());
    expect(() => store.create({ name: "///" })).toThrow(NamespaceError);
    expect(slugify("Hello, World!")).toBe("hello-world");
  });
});

describe("selectNamespaceId", () => {
  it("pins unauthenticated requests to default (ignoring the header)", () => {
    expect(selectNamespaceId(null, "ns_x")).toBe(DEFAULT_NAMESPACE_ID);
  });
  it("binds a tenant key to its own namespace", () => {
    const k = key(["run"], "ns_a");
    expect(selectNamespaceId(k, null)).toBe("ns_a");
    expect(selectNamespaceId(k, "ns_a")).toBe("ns_a");
    expect(() => selectNamespaceId(k, "ns_b")).toThrow(NamespaceForbiddenError);
  });
  it("lets an admin key proxy into any namespace", () => {
    const k = key(["admin"], null);
    expect(selectNamespaceId(k, "ns_b")).toBe("ns_b");
    expect(selectNamespaceId(k, null)).toBe(DEFAULT_NAMESPACE_ID);
  });
});

describe("NamespaceCredentialsStore", () => {
  it("reads its own file first, then falls back to the garage store", () => {
    const garageDir = tmp();
    const nsDir = tmp();
    const garage = new CredentialsStore(garageDir);
    garage.upsertProvider({ type: "known", id: "anthropic", apiKey: "garage-key" });
    const ns = new NamespaceCredentialsStore(nsDir, garage);
    // Miss in the namespace file → garage fallback.
    expect(ns.getProvider("anthropic")?.apiKey).toBe("garage-key");
    // Namespace value wins on collision.
    ns.upsertProvider({ type: "known", id: "anthropic", apiKey: "tenant-key" });
    expect(ns.getProvider("anthropic")?.apiKey).toBe("tenant-key");
    expect(garage.getProvider("anthropic")?.apiKey).toBe("garage-key"); // unchanged
  });

  it("disables the fallback when the base points at the same file (default ns)", () => {
    const dir = tmp();
    const garage = new CredentialsStore(dir);
    const same = new NamespaceCredentialsStore(dir, garage);
    expect((same as unknown as { base: unknown }).base).toBeNull();
  });
});

// --- HTTP surface --------------------------------------------------------

async function startAuthed(): Promise<{ base: string; admin: string; config: GarageConfig }> {
  const storage = new MemoryKeyStorage();
  const { key: admin } = await new KeyStore(storage).create("admin", ["admin"]);
  const config = loadGarageConfig({
    hostname: "127.0.0.1",
    port: 0,
    dataDir: tmp(),
    auth: { enabled: true, keyStorage: storage },
  });
  const garage = await startGarage(config);
  garages.push(garage);
  return { base: `http://127.0.0.1:${garage.port}`, admin, config };
}

function caller(base: string) {
  return async (method: string, p: string, opts: { key?: string; ns?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.key) headers.authorization = `Bearer ${opts.key}`;
    if (opts.ns) headers["x-glorp-namespace"] = opts.ns;
    if (opts.body) headers["content-type"] = "application/json";
    const r = await fetch(base + p, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : null };
  };
}

describe("namespace HTTP surface", () => {
  it("provisions a namespace, mints a tenant key, and isolates its sessions", async () => {
    const { base, admin, config } = await startAuthed();
    const call = caller(base);

    const created = await call("POST", "/namespaces", { key: admin, body: { name: "acme" } });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe("ns_acme");
    expect(created.body.is_default).toBe(false);

    const minted = await call("POST", "/namespaces/ns_acme/keys", { key: admin, body: { name: "acme-bot" } });
    expect(minted.status).toBe(201);
    const tenant = minted.body.data.key as string;
    expect(minted.body.data.namespace).toBe("ns_acme");
    expect(minted.body.data.scopes).not.toContain("admin");

    // A tenant-created session lives in the tenant's data subtree...
    const sess = await call("POST", "/sessions", { key: tenant, body: { permissionMode: "auto" } });
    expect(sess.status).toBe(201);
    const sid = sess.body.id as string;
    expect(fs.existsSync(path.join(config.workspaceRoot, "ns_acme", sid))).toBe(true);
    expect(fs.existsSync(path.join(config.dataDir, "namespaces", "ns_acme"))).toBe(true);

    // ...visible to the tenant, invisible to the default namespace.
    const tenantList = await call("GET", "/sessions", { key: tenant });
    expect(tenantList.body.sessions.some((s: any) => s.id === sid)).toBe(true);
    const defaultList = await call("GET", "/sessions", { key: admin });
    expect(defaultList.body.sessions.some((s: any) => s.id === sid)).toBe(false);

    // The admin can proxy into the namespace with the header.
    const proxied = await call("GET", "/sessions", { key: admin, ns: "ns_acme" });
    expect(proxied.body.sessions.some((s: any) => s.id === sid)).toBe(true);
  });

  it("forbids a tenant key from crossing into another namespace", async () => {
    const { base, admin } = await startAuthed();
    const call = caller(base);
    await call("POST", "/namespaces", { key: admin, body: { name: "a" } });
    await call("POST", "/namespaces", { key: admin, body: { name: "b" } });
    const minted = await call("POST", "/namespaces/ns_a/keys", { key: admin, body: { name: "a-bot" } });
    const tenant = minted.body.data.key as string;

    expect((await call("GET", "/sessions", { key: tenant })).status).toBe(200);
    expect((await call("GET", "/sessions", { key: tenant, ns: "ns_b" })).status).toBe(403);
  });

  it("rejects a namespace key requesting the admin scope", async () => {
    const { base, admin } = await startAuthed();
    const call = caller(base);
    await call("POST", "/namespaces", { key: admin, body: { name: "acme" } });
    const r = await call("POST", "/namespaces/ns_acme/keys", { key: admin, body: { name: "x", scopes: ["admin"] } });
    expect(r.status).toBe(400);
  });

  it("deprovisions a namespace: revokes keys, removes data, refuses default", async () => {
    const { base, admin, config } = await startAuthed();
    const call = caller(base);
    await call("POST", "/namespaces", { key: admin, body: { name: "acme" } });
    const tenant = (await call("POST", "/namespaces/ns_acme/keys", { key: admin, body: { name: "bot" } })).body.data.key;
    await call("POST", "/sessions", { key: tenant, body: { permissionMode: "auto" } });
    const nsDataDir = path.join(config.dataDir, "namespaces", "ns_acme");
    const nsSandboxRoot = path.join(config.workspaceRoot, "ns_acme");
    expect(fs.existsSync(nsDataDir)).toBe(true);
    expect(fs.existsSync(nsSandboxRoot)).toBe(true);

    const del = await call("DELETE", "/namespaces/ns_acme?data=true", { key: admin });
    expect(del.status).toBe(200);
    expect(del.body.data_removed).toBe(true);
    expect(fs.existsSync(nsDataDir)).toBe(false);
    expect(fs.existsSync(nsSandboxRoot)).toBe(false);
    // The tenant key no longer authenticates.
    expect((await call("GET", "/sessions", { key: tenant })).status).toBe(401);
    // The default namespace is protected.
    expect((await call("DELETE", "/namespaces/default", { key: admin })).status).toBe(400);
  });

  it("rejects a traversal sessionId that would escape the tenant sandbox (audit #1)", async () => {
    const { base, admin } = await startAuthed();
    const call = caller(base);
    await call("POST", "/namespaces", { key: admin, body: { name: "acme" } });
    const tenant = (await call("POST", "/namespaces/ns_acme/keys", { key: admin, body: { name: "bot" } })).body.data.key;
    // `..` would resolve the sandbox to the shared workspaceRoot — must be rejected.
    expect((await call("POST", "/sessions", { key: tenant, body: { sessionId: ".." } })).status).toBe(400);
    expect((await call("POST", "/sessions", { key: tenant, body: { sessionId: "a/b" } })).status).toBe(400);
    expect((await call("POST", "/sessions", { key: tenant, body: { sessionId: "ok-1" } })).status).toBe(201);
  });

  it("confines a tenant session's workspace to its own namespace root (audit #4)", async () => {
    const { base, admin } = await startAuthed();
    const call = caller(base);
    await call("POST", "/namespaces", { key: admin, body: { name: "acme" } });
    const tenant = (await call("POST", "/namespaces/ns_acme/keys", { key: admin, body: { name: "bot" } })).body.data.key;
    // An absolute workspace outside the namespace root must be refused for tenants.
    const out = await call("POST", "/sessions", { key: tenant, body: { workspace: "/tmp/escape-" + "x".repeat(6) } });
    expect(out.status).toBe(400);
    // The default namespace (admin) keeps the attach-any-path power.
    const ok = await call("POST", "/sessions", { key: admin, body: { workspace: tmp() } });
    expect(ok.status).toBe(201);
  });

  it("keeps the default namespace on the legacy layout (back-compat)", async () => {
    const config = loadGarageConfig({ hostname: "127.0.0.1", port: 0, dataDir: tmp() });
    const garage = await startGarage(config);
    garages.push(garage);
    const call = caller(`http://127.0.0.1:${garage.port}`);

    const list = await call("GET", "/namespaces");
    expect(list.body.namespaces).toHaveLength(1);
    expect(list.body.namespaces[0].is_default).toBe(true);

    const sess = await call("POST", "/sessions", { body: { permissionMode: "auto" } });
    // Default sandboxes live directly under workspaceRoot, NOT under namespaces/.
    expect(fs.existsSync(path.join(config.workspaceRoot, sess.body.id))).toBe(true);
    expect(fs.existsSync(path.join(config.dataDir, "namespaces"))).toBe(false);
  });
});
