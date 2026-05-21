import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  CredentialsStore,
  KNOWN_PROVIDERS,
  findKnownProvider,
  modelAcceptsReasoning,
} from "../src/agent/credentials.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-creds-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

describe("CredentialsStore", () => {
  test("starts empty when no file exists", () => {
    const store = new CredentialsStore(dataDir);
    expect(store.hasAny()).toBe(false);
    expect(store.listProfiles()).toEqual([]);
    expect(store.listProviders()).toEqual([]);
    expect(store.getActiveProfile()).toBeUndefined();
  });

  test("persists provider + profile and reloads them", () => {
    const a = new CredentialsStore(dataDir);
    a.upsertProvider({ type: "known", id: "anthropic", apiKey: "sk-test-1" });
    a.upsertProfile({
      id: "anthropic__sonnet",
      label: "anthropic · sonnet",
      providerId: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
    a.setActive("anthropic__sonnet");

    const b = new CredentialsStore(dataDir);
    expect(b.hasAny()).toBe(true);
    expect(b.getProvider("anthropic")?.apiKey).toBe("sk-test-1");
    expect(b.getActiveProfile()?.id).toBe("anthropic__sonnet");
  });

  test("file is written with 0o600 perms", () => {
    const store = new CredentialsStore(dataDir);
    store.upsertProvider({ type: "known", id: "openai", apiKey: "x" });
    const stat = fs.statSync(store.filePath);
    // Mode low 9 bits should be 0o600.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  test("supports custom providers", () => {
    const store = new CredentialsStore(dataDir);
    store.upsertProvider({
      type: "custom",
      id: "custom-foo",
      baseURL: "https://example.com/v1",
      apiKey: "sk-foo",
    });
    expect(store.getProvider("custom-foo")?.baseURL).toBe("https://example.com/v1");
  });

  test("removeProvider also drops orphan profiles", () => {
    const store = new CredentialsStore(dataDir);
    store.upsertProvider({ type: "known", id: "openai", apiKey: "k" });
    store.upsertProfile({
      id: "openai__gpt5",
      label: "openai · gpt-5",
      providerId: "openai",
      model: "gpt-5",
    });
    expect(store.listProfiles().length).toBe(1);
    store.removeProvider("openai");
    expect(store.listProfiles().length).toBe(0);
  });

  test("setActive bumps lastUsedAt and sorts to top", async () => {
    const store = new CredentialsStore(dataDir);
    for (const id of ["a", "b", "c"]) {
      store.upsertProfile({ id, label: id, providerId: "openai", model: id });
    }
    store.setActive("c");
    expect(store.listProfiles()[0]?.id).toBe("c");
  });

  test("makeProfileId is stable and filename-safe", () => {
    const id = CredentialsStore.makeProfileId("openai", "gpt-5", "high");
    expect(id).toBe("openai__gpt-5-high");
    const id2 = CredentialsStore.makeProfileId("openrouter", "anthropic/claude-sonnet-4");
    // Slash gets sanitised.
    expect(id2).toBe("openrouter__anthropic-claude-sonnet-4");
    expect(id2).not.toContain("/");
  });

  test("malformed credentials file falls back to empty without crash", () => {
    fs.writeFileSync(path.join(dataDir, "credentials.json"), "{not json", { mode: 0o600 });
    const store = new CredentialsStore(dataDir);
    expect(store.hasAny()).toBe(false);
  });

  test("wrong-version file falls back to empty", () => {
    fs.writeFileSync(
      path.join(dataDir, "credentials.json"),
      JSON.stringify({ version: 999, providers: {}, profiles: [] }),
    );
    const store = new CredentialsStore(dataDir);
    expect(store.hasAny()).toBe(false);
  });
});

describe("modelAcceptsReasoning", () => {
  test("anthropic models do not (Anthropic uses its own thinking config)", () => {
    expect(modelAcceptsReasoning("anthropic", "claude-sonnet-4-20250514")).toBe(false);
    expect(modelAcceptsReasoning("anthropic", "claude-opus-4-7")).toBe(false);
  });

  test("openai gpt-5 and o-series do", () => {
    expect(modelAcceptsReasoning("openai", "gpt-5")).toBe(true);
    expect(modelAcceptsReasoning("openai", "o3")).toBe(true);
    expect(modelAcceptsReasoning("openai", "o4-mini")).toBe(true);
  });

  test("openai gpt-4.1 does NOT", () => {
    expect(modelAcceptsReasoning("openai", "gpt-4.1")).toBe(false);
  });

  test("openrouter deepseek-r1 and chat-v4 do", () => {
    expect(modelAcceptsReasoning("openrouter", "deepseek/deepseek-r1")).toBe(true);
    expect(modelAcceptsReasoning("openrouter", "deepseek/deepseek-chat-v4")).toBe(true);
  });

  test("groq deepseek-r1 distill does", () => {
    expect(modelAcceptsReasoning("groq", "deepseek-r1-distill-llama-70b")).toBe(true);
  });

  test("gemini does not", () => {
    expect(modelAcceptsReasoning("gemini", "gemini-2.5-pro")).toBe(false);
  });

  test("custom provider falls through to a pattern check", () => {
    expect(modelAcceptsReasoning("custom-foo", "gpt-5")).toBe(true);
    expect(modelAcceptsReasoning("custom-foo", "llama-3.3-70b")).toBe(false);
  });
});

describe("KNOWN_PROVIDERS sanity", () => {
  test("each known provider has a label, envVar, defaultModels, and matchers", () => {
    for (const p of KNOWN_PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.envVar).toBe("string");
      expect(p.defaultModels.length).toBeGreaterThan(0);
      expect(Array.isArray(p.reasoningCapableModelMatchers)).toBe(true);
    }
  });

  test("findKnownProvider returns the right meta", () => {
    expect(findKnownProvider("openai")?.label).toMatch(/OpenAI/);
    expect(findKnownProvider("nope")).toBeUndefined();
  });
});
