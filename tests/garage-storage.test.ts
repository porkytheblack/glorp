/**
 * Remote uploads mirror (R2/S3): the sync engine (push diffing, no-clobber
 * pull, explicit remote delete, error status, disabled no-ops, key layout), the
 * file-routes integration (`remote` in the list response, `?pull=1`), and the
 * storage config store / route validation (secret write-only, enabled-without-
 * creds → 400). Driven against an in-process S3 stub — no network.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startS3Stub, type S3Stub } from "./s3-stub.ts";
import { StorageConfigStore } from "../src/garage/storage/config-store.ts";
import { createUploadsSync as createSync, type UploadsScopeWithData, type UploadsSyncEngine } from "../src/garage/storage/r2-sync.ts";
import { manifestPath, readManifest } from "../src/garage/storage/sync-manifest.ts";
import { storageRoutes } from "../src/garage/routes/storage.ts";
import { fileRoutes } from "../src/garage/routes/files.ts";
import { SessionManager } from "../src/garage/manager.ts";
import { loadGarageConfig } from "../src/garage/config.ts";

const tmpDirs: string[] = [];
const stubs: S3Stub[] = [];
function tmp(prefix = "storage-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const s of stubs.splice(0)) await s.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function stub(): Promise<S3Stub> {
  const s = await startS3Stub();
  stubs.push(s);
  return s;
}

/** Engine with a near-zero debounce so push timing is observable in tests. */
function createUploadsSync(store: StorageConfigStore, dataDir: string): UploadsSyncEngine {
  return createSync(store, dataDir, { debounceMs: 15 });
}

/** A store wired to a stub with a `prefix`, ready to use. */
function configuredStore(dataDir: string, endpoint: string, prefix = "mirror"): StorageConfigStore {
  const store = new StorageConfigStore(dataDir);
  store.update({
    enabled: true,
    endpoint,
    bucket: "bucket",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    prefix,
  });
  return store;
}

/** A scope with its own dataDir (where the manifest lives) and a fresh root. */
function scope(dataDir: string, sessionId: string): UploadsScopeWithData {
  const root = path.join(dataDir, "sessions", sessionId, "uploads");
  fs.mkdirSync(root, { recursive: true });
  return { nsId: "default", sessionId, root, dataDir };
}

describe("uploads sync engine — push", () => {
  it("uploads only new and changed files (manifest diffing) under prefix/ns/session", async () => {
    const s = await stub();
    const dataDir = tmp();
    const store = configuredStore(dataDir, s.endpoint);
    const sync = createUploadsSync(store, dataDir);
    const sc = scope(dataDir, "sess1");

    fs.writeFileSync(path.join(sc.root, "a.txt"), "alpha");
    fs.mkdirSync(path.join(sc.root, "sub"), { recursive: true });
    fs.writeFileSync(path.join(sc.root, "sub", "b.txt"), "beta");

    // scheduleSync debounces; the engine pushes via schedule → flush, so we
    // drive the internal push through a schedule + wait-for-objects.
    sync.scheduleSync(sc);
    await waitFor(() => s.objects.size === 2);

    expect([...s.objects.keys()].sort()).toEqual([
      "mirror/default/sess1/a.txt",
      "mirror/default/sess1/sub/b.txt",
    ]);
    expect(s.objects.get("mirror/default/sess1/a.txt")?.toString()).toBe("alpha");

    // Second sweep with no changes uploads nothing new.
    const putsBefore = s.requests.filter((r) => r.startsWith("PUT")).length;
    sync.scheduleSync(sc);
    await waitFor(() => sync.status("sess1").last_sync_at !== null, 40);
    await delay(60);
    expect(s.requests.filter((r) => r.startsWith("PUT")).length).toBe(putsBefore);

    // Editing a file re-uploads exactly that one.
    fs.writeFileSync(path.join(sc.root, "a.txt"), "alpha-2");
    await delay(10); // ensure mtime advances
    fs.utimesSync(path.join(sc.root, "a.txt"), new Date(), new Date(Date.now() + 1000));
    sync.scheduleSync(sc);
    await waitFor(() => s.objects.get("mirror/default/sess1/a.txt")?.toString() === "alpha-2");
    expect(s.requests.filter((r) => r === "PUT /bucket/mirror/default/sess1/a.txt").length).toBe(2);
  });

  it("records the manifest with synced files and a lastSyncAt", async () => {
    const s = await stub();
    const dataDir = tmp();
    const sync = createUploadsSync(configuredStore(dataDir, s.endpoint), dataDir);
    const sc = scope(dataDir, "sess2");
    fs.writeFileSync(path.join(sc.root, "report.md"), "# done");
    sync.scheduleSync(sc);
    await waitFor(() => s.objects.size === 1);

    const manifest = readManifest(manifestPath(dataDir, "sess2"));
    expect(manifest.files["report.md"]).toBeDefined();
    expect(manifest.lastSyncAt).not.toBeNull();
    expect(manifest.error).toBeNull();
  });
});

describe("uploads sync engine — pullMissing", () => {
  it("downloads remote-only files and never clobbers a local file", async () => {
    const s = await stub();
    const dataDir = tmp();
    const store = configuredStore(dataDir, s.endpoint);
    const sync = createUploadsSync(store, dataDir);
    const sc = scope(dataDir, "sess3");

    // Two remote objects; one collides with a local file that must win.
    s.objects.set("mirror/default/sess3/remote-only.txt", Buffer.from("from-r2"));
    s.objects.set("mirror/default/sess3/shared.txt", Buffer.from("REMOTE"));
    fs.writeFileSync(path.join(sc.root, "shared.txt"), "LOCAL");

    await sync.pullMissing(sc);

    expect(fs.readFileSync(path.join(sc.root, "remote-only.txt"), "utf-8")).toBe("from-r2");
    // Local wins: the collision keeps the local contents.
    expect(fs.readFileSync(path.join(sc.root, "shared.txt"), "utf-8")).toBe("LOCAL");

    // The pulled file is in the manifest so the next push won't re-upload it.
    const manifest = readManifest(manifestPath(dataDir, "sess3"));
    expect(manifest.files["remote-only.txt"]).toBeDefined();

    const putsBefore = s.requests.filter((r) => r.startsWith("PUT")).length;
    sync.scheduleSync(sc);
    await delay(80);
    // Only the local-wins shared.txt is new to the bucket; remote-only stays put.
    const puts = s.requests.filter((r) => r.startsWith("PUT"));
    expect(puts.length).toBe(putsBefore + 1);
    expect(puts).toContain("PUT /bucket/mirror/default/sess3/shared.txt");
  });

  it("pulls into nested paths", async () => {
    const s = await stub();
    const dataDir = tmp();
    const sync = createUploadsSync(configuredStore(dataDir, s.endpoint), dataDir);
    const sc = scope(dataDir, "sess4");
    s.objects.set("mirror/default/sess4/deep/nested/file.bin", Buffer.from("xyz"));
    await sync.pullMissing(sc);
    expect(fs.readFileSync(path.join(sc.root, "deep", "nested", "file.bin"), "utf-8")).toBe("xyz");
  });
});

describe("uploads sync engine — removeRemote + status", () => {
  it("deletes the bucket object on removeRemote and drops it from the manifest", async () => {
    const s = await stub();
    const dataDir = tmp();
    const sync = createUploadsSync(configuredStore(dataDir, s.endpoint), dataDir);
    const sc = scope(dataDir, "sess5");
    fs.writeFileSync(path.join(sc.root, "gone.txt"), "bye");
    sync.scheduleSync(sc);
    await waitFor(() => s.objects.has("mirror/default/sess5/gone.txt"));

    await sync.removeRemote(sc, "gone.txt");
    expect(s.objects.has("mirror/default/sess5/gone.txt")).toBe(false);
    expect(readManifest(manifestPath(dataDir, "sess5")).files["gone.txt"]).toBeUndefined();
  });

  it("status reflects an error when the bucket returns 500", async () => {
    const s = await stub();
    const dataDir = tmp();
    const sync = createUploadsSync(configuredStore(dataDir, s.endpoint), dataDir);
    const sc = scope(dataDir, "sess6");
    fs.writeFileSync(path.join(sc.root, "x.txt"), "data");
    s.failAll = true;
    sync.scheduleSync(sc);
    await waitFor(() => sync.status("sess6").error !== null);

    const st = sync.status("sess6");
    expect(st.enabled).toBe(true);
    expect(st.error).toContain("stub failure");
    // The error is persisted to the manifest too.
    expect(readManifest(manifestPath(dataDir, "sess6")).error).toContain("stub failure");
  });
});

describe("uploads sync engine — disabled", () => {
  it("is a no-op in every method when storage is unconfigured", async () => {
    const s = await stub();
    const dataDir = tmp();
    const store = new StorageConfigStore(dataDir); // never enabled
    const sync = createUploadsSync(store, dataDir);
    const sc = scope(dataDir, "sess7");
    fs.writeFileSync(path.join(sc.root, "a.txt"), "ignored");

    expect(sync.enabled()).toBe(false);
    sync.scheduleSync(sc);
    await sync.pullMissing(sc);
    await sync.removeRemote(sc, "a.txt");
    await delay(60);

    expect(s.objects.size).toBe(0);
    expect(s.requests.length).toBe(0);
    expect(sync.status("sess7")).toEqual({ enabled: false, last_sync_at: null, error: null });
  });

  it("key layout omits an empty prefix", async () => {
    const s = await stub();
    const dataDir = tmp();
    const store = new StorageConfigStore(dataDir);
    store.update({ enabled: true, endpoint: s.endpoint, bucket: "bucket", accessKeyId: "AK", secretAccessKey: "SK" });
    const sync = createUploadsSync(store, dataDir);
    const sc = scope(dataDir, "sess8");
    fs.writeFileSync(path.join(sc.root, "a.txt"), "noprefix");
    sync.scheduleSync(sc);
    await waitFor(() => s.objects.size === 1);
    expect([...s.objects.keys()]).toEqual(["default/sess8/a.txt"]);
  });
});

describe("file routes — remote status + pull", () => {
  function manager(dataDir: string): SessionManager {
    return new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
  }

  it("includes `remote` in the list response and pulls on ?pull=1", async () => {
    const s = await stub();
    const dataDir = tmp();
    const config = loadGarageConfig({ dataDir, port: 0, hostname: "127.0.0.1" });
    const m = manager(dataDir);
    const session = await m.create({ sessionId: "route1" });
    const store = configuredStore(dataDir, s.endpoint);
    const sync = createUploadsSync(store, dataDir);
    const routes = fileRoutes(m, config, "default", sync);

    // A remote-only object the list+pull should rehydrate.
    s.objects.set("mirror/default/route1/dropped.txt", Buffer.from("hi"));

    // Plain list (auto-pull-once fires here) surfaces `remote` and pulls.
    const res = await routes.list("route1", new Request("http://x/sessions/route1/files"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string }[]; remote?: { enabled: boolean } };
    expect(body.remote?.enabled).toBe(true);
    expect(body.files.map((f) => f.path)).toContain("dropped.txt");
    void session;

    // A NEW remote object after the auto-pull is ignored without ?pull=1…
    s.objects.set("mirror/default/route1/second.txt", Buffer.from("two"));
    const res2 = await routes.list("route1", new Request("http://x/sessions/route1/files"));
    const body2 = (await res2.json()) as { files: { path: string }[] };
    expect(body2.files.map((f) => f.path)).not.toContain("second.txt");

    // …but ?pull=1 forces it.
    const res3 = await routes.list("route1", new Request("http://x/sessions/route1/files?pull=1"));
    const body3 = (await res3.json()) as { files: { path: string }[] };
    expect(body3.files.map((f) => f.path)).toContain("second.txt");
  });

  it("schedules a push after upload and removes the bucket object on delete", async () => {
    const s = await stub();
    const dataDir = tmp();
    const config = loadGarageConfig({ dataDir, port: 0, hostname: "127.0.0.1" });
    const m = manager(dataDir);
    await m.create({ sessionId: "route2" });
    const sync = createUploadsSync(configuredStore(dataDir, s.endpoint), dataDir);
    const routes = fileRoutes(m, config, "default", sync);

    const form = new FormData();
    form.append("file_0", new File(["deliverable"], "out.txt"));
    const up = await routes.upload("route2", new Request("http://x", { method: "POST", body: form }));
    expect(up.status).toBe(201);
    await waitFor(() => s.objects.has("mirror/default/route2/out.txt"));
    expect(s.objects.get("mirror/default/route2/out.txt")?.toString()).toBe("deliverable");

    // REST delete propagates to the bucket.
    const del = await routes.remove("route2", "out.txt");
    expect(del.status).toBe(204);
    await waitFor(() => !s.objects.has("mirror/default/route2/out.txt"));
  });

  it("omits `remote` entirely when storage is unconfigured", async () => {
    const dataDir = tmp();
    const config = loadGarageConfig({ dataDir, port: 0, hostname: "127.0.0.1" });
    const m = manager(dataDir);
    await m.create({ sessionId: "route3" });
    const sync = createUploadsSync(new StorageConfigStore(dataDir), dataDir);
    const routes = fileRoutes(m, config, "default", sync);
    const res = await routes.list("route3", new Request("http://x/sessions/route3/files"));
    const body = (await res.json()) as { remote?: unknown };
    expect(body.remote).toBeUndefined();
  });
});

describe("storage config store + route", () => {
  it("keeps the secret write-only: dto reports has_secret, never the value", () => {
    const store = new StorageConfigStore(tmp());
    store.update({ enabled: true, endpoint: "https://r2", bucket: "b", accessKeyId: "AK", secretAccessKey: "SECRET" });
    const dto = store.dto();
    expect(dto.has_secret).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("SECRET");
    // An update that omits the secret keeps it.
    store.update({ prefix: "p" });
    expect(store.usable()).toBe(true);
    expect(store.get().secretAccessKey).toBe("SECRET");
  });

  it("rejects enabling storage without complete credentials (400)", async () => {
    const store = new StorageConfigStore(tmp());
    const routes = storageRoutes(store);
    const req = new Request("http://x/storage", { method: "PUT", body: JSON.stringify({ enabled: true, endpoint: "https://r2" }) });
    const res = await routes.update(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/missing/i);
  });

  it("accepts a complete config and round-trips the dto", async () => {
    const store = new StorageConfigStore(tmp());
    const routes = storageRoutes(store);
    const req = new Request("http://x/storage", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, endpoint: "https://r2", bucket: "b", access_key_id: "AK", secret_access_key: "SK", prefix: "/team/" }),
    });
    const res = await routes.update(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storage: { has_secret: boolean; prefix: string | null; enabled: boolean } };
    expect(body.storage.enabled).toBe(true);
    expect(body.storage.has_secret).toBe(true);
    expect(body.storage.prefix).toBe("team"); // normalized: slashes stripped
    // GET reflects it.
    const got = (await routes.get().json()) as { storage: { bucket: string | null } };
    expect(got.storage.bucket).toBe("b");
  });
});

/** Poll until `cond` is true (sync engine work is async/debounced). */
async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await delay(20);
  }
  throw new Error("waitFor: condition never became true");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
