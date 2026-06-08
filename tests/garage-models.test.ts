/**
 * Model catalog + add/select endpoints, and the funny-name session id.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";
import { randomSessionName } from "../src/agent/session-name.ts";
import { newSessionId } from "../src/agent/sessions.ts";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "models-test-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("session codenames", () => {
  it("newSessionId is an adjective-noun-suffix slug, never a date", () => {
    for (let i = 0; i < 20; i++) {
      const id = newSessionId();
      expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{4}$/);
      expect(id).not.toMatch(/\d{4}-\d{2}-\d{2}/); // not an ISO timestamp
    }
    expect(randomSessionName()).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]{4}$/);
  });
});

describe("Model endpoints", () => {
  async function withGarage(fn: (call: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }>) => Promise<void>) {
    const dataDir = tmp();
    const garage = await startGarage(loadGarageConfig({ dataDir, port: 0, hostname: "127.0.0.1" }));
    const base = `http://127.0.0.1:${garage.port}`;
    const call = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(base + p, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const t = await r.text();
      return { status: r.status, body: t ? JSON.parse(t) : null };
    };
    try {
      await fn(call);
    } finally {
      await garage.stop();
    }
  }

  it("serves the known-provider catalog", async () => {
    await withGarage(async (call) => {
      const cat = await call("GET", "/models/catalog");
      expect(cat.status).toBe(200);
      const anthropic = cat.body.providers.find((p: any) => p.id === "anthropic");
      expect(anthropic.needs_api_key).toBe(true);
      expect(anthropic.default_models.length).toBeGreaterThan(0);
    });
  });

  it("adds a provider + profile, lists + activates, and never returns the key", async () => {
    await withGarage(async (call) => {
      const prov = await call("POST", "/models/providers", { type: "known", id: "anthropic", apiKey: "sk-ant-secret-9999" });
      expect(prov.status).toBe(201);
      expect(prov.body.has_api_key).toBe(true);
      expect(JSON.stringify(prov.body)).not.toContain("secret");

      const providers = await call("GET", "/models/providers");
      expect(providers.body.providers.some((p: any) => p.id === "anthropic")).toBe(true);
      expect(JSON.stringify(providers.body)).not.toContain("secret");

      const prof = await call("POST", "/models/profiles", { providerId: "anthropic", model: "claude-opus-4-7", activate: true });
      expect(prof.status).toBe(201);
      const profId = prof.body.id;

      const profiles = await call("GET", "/models/profiles");
      expect(profiles.body.active_profile_id).toBe(profId);
      expect(profiles.body.profiles.some((p: any) => p.id === profId)).toBe(true);

      // re-activate is idempotent
      expect((await call("POST", `/models/profiles/${profId}/activate`)).status).toBe(200);
    });
  });

  it("deletes profiles and providers", async () => {
    await withGarage(async (call) => {
      await call("POST", "/models/providers", { type: "known", id: "openai", apiKey: "sk-x" });
      const prof = await call("POST", "/models/profiles", { providerId: "openai", model: "gpt-4.1" });
      const profId = prof.body.id;

      expect((await call("DELETE", `/models/profiles/${profId}`)).status).toBe(204);
      expect((await call("GET", "/models/profiles")).body.profiles.some((p: any) => p.id === profId)).toBe(false);

      expect((await call("DELETE", "/models/providers/openai")).status).toBe(204);
      expect((await call("GET", "/models/providers")).body.providers.some((p: any) => p.id === "openai")).toBe(false);

      expect((await call("DELETE", "/models/providers/nope")).status).toBe(404);
    });
  });
});
