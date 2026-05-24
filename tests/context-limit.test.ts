import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { CredentialsStore } from "../src/agent/credentials.ts";
import { pickModel } from "../src/agent/model-picker.ts";
import { ModelCatalog, DEFAULT_FALLBACK_CONTEXT_LIMIT } from "../src/agent/model-catalog.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-ctx-"));
});

afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

function makeOfflineCatalog(): ModelCatalog {
  // No-op fetch so the test never reaches LiteLLM. The catalog will report
  // `undefined` for any lookup and the picker will fall through.
  return new ModelCatalog(dataDir, {
    fetchImpl: (async () =>
      new Response("", { status: 500 })) as unknown as typeof fetch,
  });
}

describe("resolveContextLimit precedence", () => {
  test("falls back to DEFAULT_FALLBACK_CONTEXT_LIMIT when nothing overrides", async () => {
    const creds = new CredentialsStore(dataDir);
    creds.upsertProvider({
      type: "custom",
      id: "custom-ziomi",
      adapter: "openai-compat",
      baseURL: "https://ziomi.example/v1",
      apiKey: "k",
    });
    creds.upsertProfile({
      id: "p1",
      label: "ziomi · ziomi-1",
      providerId: "custom-ziomi",
      model: "ziomi-1",
    });
    creds.setActive("p1");

    const picked = await pickModel({ credentials: creds, catalog: makeOfflineCatalog() });
    expect(picked.contextLimit).toBe(DEFAULT_FALLBACK_CONTEXT_LIMIT);
  });

  test("provider.contextLimit overrides the 128k fallback (ziomi-style bug fix)", async () => {
    const creds = new CredentialsStore(dataDir);
    creds.upsertProvider({
      type: "custom",
      id: "custom-ziomi",
      adapter: "openai-compat",
      baseURL: "https://ziomi.example/v1",
      apiKey: "k",
      contextLimit: 262_144,
    });
    creds.upsertProfile({
      id: "p1",
      label: "ziomi · ziomi-1",
      providerId: "custom-ziomi",
      model: "ziomi-1",
    });
    creds.setActive("p1");

    const picked = await pickModel({ credentials: creds, catalog: makeOfflineCatalog() });
    expect(picked.contextLimit).toBe(262_144);
  });

  test("profile.contextLimit wins over provider.contextLimit", async () => {
    const creds = new CredentialsStore(dataDir);
    creds.upsertProvider({
      type: "custom",
      id: "custom-ziomi",
      adapter: "openai-compat",
      baseURL: "https://ziomi.example/v1",
      apiKey: "k",
      contextLimit: 200_000,
    });
    creds.upsertProfile({
      id: "p1",
      label: "ziomi · ziomi-1",
      providerId: "custom-ziomi",
      model: "ziomi-1",
      contextLimit: 500_000,
    });
    creds.setActive("p1");

    const picked = await pickModel({ credentials: creds, catalog: makeOfflineCatalog() });
    expect(picked.contextLimit).toBe(500_000);
  });

  test("a zero-valued override is ignored (treated as unset)", async () => {
    const creds = new CredentialsStore(dataDir);
    creds.upsertProvider({
      type: "custom",
      id: "custom-z",
      adapter: "openai-compat",
      baseURL: "https://z.example/v1",
      apiKey: "k",
      contextLimit: 0,
    });
    creds.upsertProfile({
      id: "p1",
      label: "z · m",
      providerId: "custom-z",
      model: "m",
      contextLimit: 0,
    });
    creds.setActive("p1");

    const picked = await pickModel({ credentials: creds, catalog: makeOfflineCatalog() });
    expect(picked.contextLimit).toBe(DEFAULT_FALLBACK_CONTEXT_LIMIT);
  });
});
