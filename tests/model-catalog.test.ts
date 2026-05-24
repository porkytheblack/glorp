import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { ModelCatalog, DEFAULT_FALLBACK_CONTEXT_LIMIT } from "../src/agent/model-catalog.ts";
import { pickModel } from "../src/agent/model-picker.ts";
import { CredentialsStore } from "../src/agent/credentials.ts";

let dataDir: string;
let savedKeys: Record<string, string | undefined>;

const KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MIMO_API_KEY",
  "GLORP_DISABLE_CATALOG_REFRESH",
];

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-cat-"));
  savedKeys = {};
  for (const v of KEY_VARS) {
    savedKeys[v] = process.env[v];
    delete process.env[v];
  }
  process.env.GLORP_DISABLE_CATALOG_REFRESH = "1";
});

afterEach(() => {
  for (const v of KEY_VARS) {
    if (savedKeys[v] === undefined) delete process.env[v];
    else process.env[v] = savedKeys[v];
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

function seedCache(entries: Record<string, { max_input_tokens?: number; max_tokens?: number }>) {
  fs.writeFileSync(
    path.join(dataDir, "model-catalog.json"),
    JSON.stringify({ fetched_at: Date.now(), source: "test", entries }),
  );
}

describe("ModelCatalog.getContextLimit", () => {
  test("returns undefined when no cache exists", () => {
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("anthropic", "claude-opus-4-7")).toBeUndefined();
  });

  test("direct key match returns max_input_tokens", () => {
    seedCache({ "gpt-5": { max_input_tokens: 400_000 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("openai", "gpt-5")).toBe(400_000);
  });

  test("falls back to max_tokens when max_input_tokens is missing", () => {
    seedCache({ "weird-model": { max_tokens: 65_536 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("custom", "weird-model")).toBe(65_536);
  });

  test("provider-prefixed key matches when bare name doesn't", () => {
    seedCache({ "groq/llama-3.3-70b-versatile": { max_input_tokens: 128_000 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("groq", "llama-3.3-70b-versatile")).toBe(128_000);
  });

  test("openrouter-routed model name finds the openrouter-prefixed key", () => {
    seedCache({ "openrouter/anthropic/claude-opus-4-7": { max_input_tokens: 200_000 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("openrouter", "anthropic/claude-opus-4-7")).toBe(200_000);
  });

  test("suffix-matches a dated variant", () => {
    seedCache({ "claude-opus-4-7-20251201": { max_input_tokens: 200_000 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("anthropic", "claude-opus-4-7")).toBe(200_000);
  });

  test("picks the highest limit when multiple dated variants exist", () => {
    seedCache({
      "claude-opus-4-7-20251101": { max_input_tokens: 200_000 },
      "claude-opus-4-7-20251201": { max_input_tokens: 250_000 },
    });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("anthropic", "claude-opus-4-7")).toBe(250_000);
  });

  test("suffix match rejects non-numeric tails to avoid false positives", () => {
    seedCache({ "claude-opus-4-7-thinking-variant": { max_input_tokens: 999_999 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("anthropic", "claude-opus-4-7")).toBeUndefined();
  });

  test("zero or missing limit is treated as no match", () => {
    seedCache({ "phantom-model": { max_input_tokens: 0 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("openai", "phantom-model")).toBeUndefined();
  });
});

describe("ModelCatalog.refresh", () => {
  test("populates cache and writes to disk", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({
        sample_spec: { foo: "bar" },
        "mimo-pro-v2": { max_input_tokens: 1_000_000 },
      }))) as unknown as typeof fetch;
    const cat = new ModelCatalog(dataDir, { fetchImpl });
    delete process.env.GLORP_DISABLE_CATALOG_REFRESH;
    await cat.refresh();
    expect(cat.getContextLimit("mimo", "mimo-pro-v2")).toBe(1_000_000);
    expect(fs.existsSync(path.join(dataDir, "model-catalog.json"))).toBe(true);
  });

  test("new instance loads from disk", async () => {
    seedCache({ "gpt-4o": { max_input_tokens: 128_000 } });
    const cat = new ModelCatalog(dataDir);
    expect(cat.getContextLimit("openai", "gpt-4o")).toBe(128_000);
  });

  test("network failure leaves prior cache intact", async () => {
    seedCache({ "gpt-4o": { max_input_tokens: 128_000 } });
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const cat = new ModelCatalog(dataDir, { fetchImpl });
    delete process.env.GLORP_DISABLE_CATALOG_REFRESH;
    await cat.refresh();
    expect(cat.getContextLimit("openai", "gpt-4o")).toBe(128_000);
  });

  test("disable env var prevents background refresh", () => {
    seedCache({ "x": { max_input_tokens: 1 } });
    let fetched = false;
    const fetchImpl = (async () => {
      fetched = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    // Pretend the cache is ancient by editing the file.
    fs.writeFileSync(
      path.join(dataDir, "model-catalog.json"),
      JSON.stringify({ fetched_at: 0, source: "old", entries: { x: { max_input_tokens: 1 } } }),
    );
    const cat = new ModelCatalog(dataDir, { fetchImpl });
    cat.getContextLimit("openai", "x");
    expect(fetched).toBe(false);
  });
});

describe("pickModel + catalog integration", () => {
  test("uses default fallback when no catalog is provided", async () => {
    process.env.OPENAI_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.contextLimit).toBe(DEFAULT_FALLBACK_CONTEXT_LIMIT);
  });

  test("uses catalog value when available", async () => {
    seedCache({ "gpt-5": { max_input_tokens: 400_000 } });
    process.env.OPENAI_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const catalog = new ModelCatalog(dataDir);
    const picked = await pickModel({
      provider: "openai",
      model: "gpt-5",
      credentials,
      catalog,
    });
    expect(picked.contextLimit).toBe(400_000);
  });

  test("profile override beats catalog", async () => {
    seedCache({ "mimo-v2.5-pro": { max_input_tokens: 256_000 } });
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "mimo", apiKey: "k" });
    credentials.upsertProfile({
      id: "mimo__custom",
      label: "mimo",
      providerId: "mimo",
      model: "mimo-v2.5-pro",
      contextLimit: 1_000_000,
    });
    credentials.setActive("mimo__custom");
    const catalog = new ModelCatalog(dataDir);
    const picked = await pickModel({ credentials, catalog });
    expect(picked.contextLimit).toBe(1_000_000);
  });

  test("falls back when catalog has no entry for the model", async () => {
    seedCache({ "some-other-model": { max_input_tokens: 64_000 } });
    process.env.OPENAI_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const catalog = new ModelCatalog(dataDir);
    const picked = await pickModel({
      provider: "openai",
      model: "totally-unknown-model",
      credentials,
      catalog,
    });
    expect(picked.contextLimit).toBe(DEFAULT_FALLBACK_CONTEXT_LIMIT);
  });
});
