/**
 * Admin dashboard auth: env-provisioned username/password → JWT login, the
 * /auth/status and /auth/me endpoints, and using the JWT (admin scope) to mint
 * an API key for the REST API / MCP server.
 */

import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage, type GarageHandle } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";
import { MemoryKeyStorage } from "../src/garage/auth/memory-key-storage.ts";

const tmpDirs: string[] = [];
const garages: GarageHandle[] = [];
const savedEnv: Record<string, string | undefined> = {};

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "admin-auth-"));
  tmpDirs.push(d);
  return d;
}

beforeEach(() => {
  for (const k of ["GARAGE_ADMIN_USER", "GARAGE_ADMIN_PASSWORD", "GARAGE_JWT_SECRET"]) {
    savedEnv[k] = process.env[k];
  }
  process.env.GARAGE_ADMIN_USER = "boss";
  process.env.GARAGE_ADMIN_PASSWORD = "hunter2";
  process.env.GARAGE_JWT_SECRET = "test-secret";
});

afterEach(async () => {
  for (const s of garages.splice(0)) await s.stop().catch(() => {});
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function startAuthedGarage(): Promise<{ base: string }> {
  const config = loadGarageConfig({
    hostname: "127.0.0.1",
    port: 0,
    dataDir: tmp(),
    auth: { enabled: true, keyStorage: new MemoryKeyStorage() },
  });
  const g = await startGarage(config);
  garages.push(g);
  return { base: `http://127.0.0.1:${g.port}/api/v1` };
}

const post = (base: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("admin login", () => {
  it("reports admin_login availability", async () => {
    const { base } = await startAuthedGarage();
    const r = await fetch(base + "/auth/status");
    expect(r.status).toBe(200);
    expect((await r.json()).admin_login).toBe(true);
  });

  it("rejects wrong credentials and accepts the right ones", async () => {
    const { base } = await startAuthedGarage();
    expect((await post(base, "/auth/login", { username: "boss", password: "nope" })).status).toBe(401);
    const ok = await post(base, "/auth/login", { username: "boss", password: "hunter2" });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(typeof body.token).toBe("string");
    expect(body.user).toBe("boss");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("echoes identity via /auth/me with the JWT", async () => {
    const { base } = await startAuthedGarage();
    const { token } = await (await post(base, "/auth/login", { username: "boss", password: "hunter2" })).json();
    const me = await fetch(base + "/auth/me", { headers: { authorization: `Bearer ${token}` } });
    const body = await me.json();
    expect(body.authenticated).toBe(true);
    expect(body.user).toBe("boss");
    expect(body.is_admin).toBe(true);
  });

  it("a bare API request without credential is 401", async () => {
    const { base } = await startAuthedGarage();
    expect((await fetch(base + "/sessions")).status).toBe(401);
  });

  it("the JWT authorizes minting an API key for the REST API / MCP", async () => {
    const { base } = await startAuthedGarage();
    const { token } = await (await post(base, "/auth/login", { username: "boss", password: "hunter2" })).json();
    const headers = { authorization: `Bearer ${token}` };

    const minted = await post(base, "/keys", { name: "mcp-server", scopes: ["admin"] }, headers);
    expect(minted.status).toBe(201);
    const { data } = await minted.json();
    expect(data.key.startsWith("glsk_")).toBe(true);

    // The minted key works on a protected route…
    expect((await fetch(base + "/sessions", { headers: { authorization: `Bearer ${data.key}` } })).status).toBe(200);
    // …and the JWT can list keys it owns.
    const list = await fetch(base + "/keys", { headers });
    expect(list.status).toBe(200);
    expect(Array.isArray((await list.json()).data)).toBe(true);
  });

  it("an expired/forged JWT is rejected", async () => {
    const { base } = await startAuthedGarage();
    const bad = await fetch(base + "/sessions", { headers: { authorization: "Bearer not.a.jwt" } });
    expect(bad.status).toBe(401);
  });
});
