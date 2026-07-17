/**
 * Per-namespace template libraries: a tenant's own on-disk templates layered
 * over the garage-global catalog (inherit-and-override), the origin dir the
 * engine uses to resolve `skill.from`, and the end-to-end HTTP surface — a
 * tenant's /templates and /tasks/types reflect its catalog, while the default
 * namespace and empty-dir tenants stay unchanged (backward compatible).
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage, type GarageHandle } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";
import { KeyStore } from "../src/garage/auth/key-store.ts";
import { MemoryKeyStorage } from "../src/garage/auth/memory-key-storage.ts";
import { NamespaceStore } from "../src/garage/namespace-store.ts";
import { TemplateStore } from "../src/garage/templates/store.ts";
import { compositeTemplateSource } from "../src/garage/templates/source.ts";
import { namespaceTemplateSource, type RemoteLike } from "../src/garage/templates/namespace-source.ts";
import type { Template } from "../src/garage/templates/types.ts";

const tmpDirs: string[] = [];
const garages: GarageHandle[] = [];
const stubs: Array<{ stop: () => void }> = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmpl-"));
  tmpDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const s of garages.splice(0)) await s.stop().catch(() => {});
  for (const s of stubs.splice(0)) s.stop();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** An in-memory companion registry — the read surface a real one exposes. */
function fakeRemote(templates: Record<string, string>): RemoteLike {
  const mk = (name: string, description: string): Template =>
    ({ name, description, system_prompt: "x" }) as Template;
  return {
    list: async () => Object.entries(templates).map(([n, d]) => mk(n, d)),
    get: async (name) => (templates[name] ? mk(name, templates[name]!) : undefined),
  };
}

/** A stub companion HTTP service returning a fixed template list. */
function startStubCompanion(templates: Array<Record<string, unknown>>): { url: string; stop: () => void } {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ templates }) });
  const stub = { url: `http://127.0.0.1:${server.port}/v1/templates`, stop: () => server.stop(true) };
  stubs.push(stub);
  return stub;
}

// A template is skipped by the loader unless it provisions SOMETHING, so every
// fixture carries a `system_prompt` section; `body` still supplies description/etc.
function writeTemplate(dir: string, name: string, body: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ system_prompt: `You are ${name}.`, ...body }));
}

describe("namespaceTemplateSource", () => {
  it("inherits the garage catalog and overrides by name (tenant wins)", async () => {
    const garageDir = tmp();
    const tenantDir = tmp();
    writeTemplate(garageDir, "deck", { description: "garage deck" });
    writeTemplate(garageDir, "video", { description: "garage video" });
    writeTemplate(tenantDir, "deck", { description: "tenant deck" }); // override
    writeTemplate(tenantDir, "report", { description: "tenant report" }); // add

    const src = namespaceTemplateSource(tenantDir, compositeTemplateSource(new TemplateStore(garageDir)), garageDir);

    expect((await src.list()).map((t) => t.name)).toEqual(["deck", "report", "video"]); // union, deduped, sorted
    expect((await src.get("deck"))?.description).toBe("tenant deck"); // tenant wins
    expect((await src.get("video"))?.description).toBe("garage video"); // inherited
    expect(await src.has("report")).toBe(true);
    expect(await src.has("missing")).toBe(false);
  });

  it("reports the origin dir so skill.from resolves under the right root", async () => {
    const garageDir = tmp();
    const tenantDir = tmp();
    writeTemplate(garageDir, "deck", { description: "garage deck" });
    writeTemplate(garageDir, "video", { description: "garage video" });
    writeTemplate(tenantDir, "deck", { description: "tenant deck" });

    const src = namespaceTemplateSource(tenantDir, compositeTemplateSource(new TemplateStore(garageDir)), garageDir);

    expect((await src.resolve("deck"))?.templatesDir).toBe(tenantDir); // tenant-owned
    expect((await src.resolve("video"))?.templatesDir).toBe(garageDir); // inherited
    expect(await src.resolve("missing")).toBeUndefined();
  });

  it("degenerates to the garage source for the default namespace (tenantDir null)", async () => {
    const garageDir = tmp();
    writeTemplate(garageDir, "deck", { description: "garage deck" });
    const src = namespaceTemplateSource(null, compositeTemplateSource(new TemplateStore(garageDir)), garageDir);
    expect((await src.list()).map((t) => t.name)).toEqual(["deck"]);
    expect((await src.resolve("deck"))?.templatesDir).toBe(garageDir);
  });
});

async function startAuthed(): Promise<{ base: string; admin: string; config: ReturnType<typeof loadGarageConfig> }> {
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

const nameMap = (templates: Array<{ name: string; description: string | null }>) =>
  Object.fromEntries(templates.map((t) => [t.name, t.description]));

describe("per-namespace templates over HTTP", () => {
  it("a tenant sees inherited garage templates plus its own; the default namespace is unaffected", async () => {
    const { base, admin, config } = await startAuthed();
    const call = caller(base);
    writeTemplate(config.templatesDir, "garage-deck", { description: "garage deck" }); // garage-global

    await call("POST", "/namespaces", { key: admin, body: { name: "acme" } });
    const tenantDir = path.join(config.dataDir, "namespaces", "ns_acme", "templates");
    writeTemplate(tenantDir, "acme-report", { description: "acme report" }); // tenant-only
    writeTemplate(tenantDir, "garage-deck", { description: "acme deck override" }); // override

    const minted = await call("POST", "/namespaces/ns_acme/keys", { key: admin, body: { name: "bot" } });
    const tenant = minted.body.data.key as string;

    // Tenant /templates: inherited + own, with the override winning.
    const tenantList = await call("GET", "/templates", { key: tenant });
    const byName = nameMap(tenantList.body.templates);
    expect(byName["acme-report"]).toBe("acme report");
    expect(byName["garage-deck"]).toBe("acme deck override");
    const one = await call("GET", "/templates/garage-deck", { key: tenant });
    expect(one.body.template.description).toBe("acme deck override");

    // /tasks/types reflects the same tenant catalog.
    const types = await call("GET", "/tasks/types", { key: tenant });
    expect(types.body.types.map((t: { name: string }) => t.name)).toContain("acme-report");

    // The default namespace is untouched: garage template, never the tenant's.
    const defList = await call("GET", "/templates", { key: admin });
    const defNames = defList.body.templates.map((t: { name: string }) => t.name);
    expect(defNames).toContain("garage-deck");
    expect(defNames).not.toContain("acme-report");
    const defOne = await call("GET", "/templates/garage-deck", { key: admin });
    expect(defOne.body.template.description).toBe("garage deck");
  });

  it("a tenant with no templates dir inherits the full garage catalog unchanged", async () => {
    const { base, admin, config } = await startAuthed();
    const call = caller(base);
    writeTemplate(config.templatesDir, "garage-deck", { description: "garage deck" });

    await call("POST", "/namespaces", { key: admin, body: { name: "empty" } });
    const tenant = (await call("POST", "/namespaces/ns_empty/keys", { key: admin, body: { name: "bot" } })).body.data.key;

    const list = await call("GET", "/templates", { key: tenant });
    expect(list.body.templates.map((t: { name: string }) => t.name)).toContain("garage-deck");
  });
});

describe("per-namespace companion registry", () => {
  it("layers tenant disk > tenant companion > garage catalog", async () => {
    const garageDir = tmp();
    const tenantDir = tmp();
    writeTemplate(garageDir, "shared", { description: "garage shared" });
    writeTemplate(garageDir, "garage-only", { description: "garage only" });
    writeTemplate(garageDir, "co-vs-garage", { description: "garage version" });
    writeTemplate(tenantDir, "shared", { description: "tenant disk shared" }); // disk override
    const remote = fakeRemote({
      shared: "companion shared",
      "companion-only": "from companion",
      "co-vs-garage": "companion version",
    });
    const src = namespaceTemplateSource(tenantDir, compositeTemplateSource(new TemplateStore(garageDir)), garageDir, remote);

    expect((await src.get("shared"))?.description).toBe("tenant disk shared"); // disk beats companion + garage
    expect((await src.get("co-vs-garage"))?.description).toBe("companion version"); // companion beats garage
    expect((await src.get("companion-only"))?.description).toBe("from companion"); // companion-only surfaces
    expect((await src.get("garage-only"))?.description).toBe("garage only"); // inherited
    expect((await src.list()).map((t) => t.name)).toEqual(["co-vs-garage", "companion-only", "garage-only", "shared"]);
    // A companion template with no disk override resolves `skill.from` under the garage dir, not the tenant's.
    expect((await src.resolve("companion-only"))?.templatesDir).toBe(garageDir);
    expect((await src.resolve("shared"))?.templatesDir).toBe(tenantDir);
  });

  it("persists and reloads a namespace's companion registry (headers kept, path re-derived)", () => {
    const dataDir = tmp();
    const store = new NamespaceStore(dataDir, path.join(dataDir, "ws"));
    const ns = store.create({
      name: "acme",
      template_registry: { url: "https://svc.example/v1/templates", headers: { authorization: "Bearer sekret" } },
    });
    expect(ns.templateRegistry?.url).toBe("https://svc.example/v1/templates");

    const reloaded = new NamespaceStore(dataDir, path.join(dataDir, "ws"));
    expect(reloaded.get(ns.id)?.templateRegistry?.headers?.authorization).toBe("Bearer sekret");
  });

  it("rejects a non-http(s) companion registry URL at create", () => {
    const dataDir = tmp();
    const store = new NamespaceStore(dataDir, path.join(dataDir, "ws"));
    expect(() => store.create({ name: "x", template_registry: { url: "ftp://nope" } })).toThrow();
  });

  it("serves a namespace's companion templates over HTTP, layered with garage; headers stay secret", async () => {
    const { base, admin, config } = await startAuthed();
    const call = caller(base);
    writeTemplate(config.templatesDir, "garage-deck", { description: "garage deck" }); // garage-global

    const stub = startStubCompanion([
      { name: "companion-report", description: "from companion", system_prompt: "x" },
      { name: "garage-deck", description: "companion deck override", system_prompt: "x" }, // beats garage
    ]);

    const created = await call("POST", "/namespaces", {
      key: admin,
      body: { name: "acme", template_registry: { url: stub.url, headers: { authorization: "Bearer k" } } },
    });
    expect(created.body.template_registry_url).toBe(stub.url); // URL surfaced...
    expect(JSON.stringify(created.body)).not.toContain("Bearer k"); // ...headers never are
    const tenant = (await call("POST", "/namespaces/ns_acme/keys", { key: admin, body: { name: "bot" } })).body.data.key;

    const byName = nameMap((await call("GET", "/templates", { key: tenant })).body.templates);
    expect(byName["companion-report"]).toBe("from companion"); // companion template surfaced
    expect(byName["garage-deck"]).toBe("companion deck override"); // companion beats garage
    const types = await call("GET", "/tasks/types", { key: tenant });
    expect(types.body.types.map((t: { name: string }) => t.name)).toContain("companion-report");

    // The default namespace never sees the tenant's companion catalog.
    const def = await call("GET", "/templates", { key: admin });
    expect(def.body.templates.map((t: { name: string }) => t.name)).not.toContain("companion-report");
  });
});
