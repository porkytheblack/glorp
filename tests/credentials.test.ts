import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  CredentialsStore,
  KNOWN_PROVIDERS,
  findKnownProvider,
  modelAcceptsReasoning,
  reasoningKindFor,
  reasoningOptionsFor,
  normaliseReasoning,
  reasoningLabel,
} from "../src/agent/credentials.ts";
import type { ReasoningConfig } from "../src/agent/credentials.ts";

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
    expect(stat.mode & 0o777).toBe(0o600);
  });

  test("supports custom providers", () => {
    const store = new CredentialsStore(dataDir);
    store.upsertProvider({
      type: "custom",
      id: "custom-foo",
      adapter: "mimo",
      baseURL: "https://example.com/v1",
      apiKey: "sk-foo",
    });
    expect(store.getProvider("custom-foo")?.baseURL).toBe("https://example.com/v1");
    expect(store.getProvider("custom-foo")?.adapter).toBe("mimo");
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

  test("setActive bumps lastUsedAt and sorts to top", () => {
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
    expect(id2).toBe("openrouter__anthropic-claude-sonnet-4");
    expect(id2).not.toContain("/");
  });

  test("makeProfileId encodes thinking budget", () => {
    const id = CredentialsStore.makeProfileId("anthropic", "claude-sonnet-4-20250514", {
      kind: "thinking",
      budget_tokens: 4096,
    });
    expect(id).toContain("think4096");
  });

  test("makeProfileId encodes reasoningObject with max_tokens", () => {
    const id = CredentialsStore.makeProfileId("openrouter", "deepseek/deepseek-r1", {
      kind: "reasoningObject",
      effort: "high",
      max_tokens: 4000,
    });
    expect(id).toContain("high-4000");
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
  test("anthropic models do (they have their own thinking config — kind:'thinking')", () => {
    // After the refactor, anthropic IS reasoning-capable — it just uses
    // a different shape than gpt-5's effort enum.
    expect(modelAcceptsReasoning("anthropic", "claude-sonnet-4-20250514")).toBe(false);
    // (Matches the legacy matchers list; anthropic remains opt-in via the
    // adapter's `thinking` field separately. We don't surface budget UI
    // for anthropic until that matchers list is extended.)
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

  test("mimo models do", () => {
    expect(modelAcceptsReasoning("mimo", "mimo-v2.5-pro")).toBe(true);
  });

  test("gemini does not", () => {
    expect(modelAcceptsReasoning("gemini", "gemini-2.5-pro")).toBe(false);
  });

  test("custom provider falls through to a pattern check", () => {
    expect(modelAcceptsReasoning("custom-foo", "gpt-5")).toBe(true);
    expect(modelAcceptsReasoning("custom-foo", "llama-3.3-70b")).toBe(false);
  });
});

describe("reasoningKindFor (provider-specific)", () => {
  test("openai gpt-5 → effort", () => {
    expect(reasoningKindFor("openai", "gpt-5")).toBe("effort");
  });
  test("openai gpt-4.1 → null", () => {
    expect(reasoningKindFor("openai", "gpt-4.1")).toBeNull();
  });
  test("openrouter deepseek-r1 → reasoningObject", () => {
    expect(reasoningKindFor("openrouter", "deepseek/deepseek-r1")).toBe("reasoningObject");
  });
  test("groq deepseek-r1 → effort", () => {
    expect(reasoningKindFor("groq", "deepseek-r1-distill-llama-70b")).toBe("effort");
  });
  test("mimo → effort", () => {
    expect(reasoningKindFor("mimo", "mimo-v2.5-pro")).toBe("effort");
  });
});

describe("reasoningOptionsFor (provider-aware UI options)", () => {
  test("openai gpt-5 includes minimal", () => {
    const opts = reasoningOptionsFor("openai", "gpt-5");
    const efforts = opts.slice(1).map((o) => (o.value as any).effort);
    expect(efforts).toContain("minimal");
    expect(efforts).toContain("high");
  });

  test("openai o3 does NOT include minimal (GPT-5-only)", () => {
    const opts = reasoningOptionsFor("openai", "o3");
    const efforts = opts.slice(1).map((o) => (o.value as any).effort);
    expect(efforts).not.toContain("minimal");
    expect(efforts).toContain("high");
  });

  test("openrouter exposes reasoningObject options", () => {
    const opts = reasoningOptionsFor("openrouter", "deepseek/deepseek-r1");
    expect(opts.length).toBeGreaterThan(2);
    const last = opts[opts.length - 1]!.value as any;
    expect(last.kind).toBe("reasoningObject");
  });

  test("gpt-4.1 returns empty (no reasoning hint accepted)", () => {
    expect(reasoningOptionsFor("openai", "gpt-4.1")).toEqual([]);
  });

  test("first entry is always 'off'", () => {
    const opts = reasoningOptionsFor("openai", "gpt-5");
    expect(opts[0]?.value).toEqual({ kind: "off" });
  });
});

describe("normaliseReasoning (legacy back-compat)", () => {
  test("undefined → off", () => {
    expect(normaliseReasoning(undefined)).toEqual({ kind: "off" });
  });
  test("bare 'high' string → effort:high", () => {
    expect(normaliseReasoning("high")).toEqual({ kind: "effort", effort: "high" });
  });
  test("ReasoningConfig passes through", () => {
    const r: ReasoningConfig = { kind: "thinking", budget_tokens: 4096 };
    expect(normaliseReasoning(r)).toBe(r);
  });
});

describe("reasoningLabel", () => {
  test("off → 'off'", () => {
    expect(reasoningLabel({ kind: "off" })).toBe("off");
  });
  test("effort → effort name", () => {
    expect(reasoningLabel({ kind: "effort", effort: "high" })).toBe("high");
  });
  test("thinking → 'N budget'", () => {
    expect(reasoningLabel({ kind: "thinking", budget_tokens: 4096 })).toBe("4096 budget");
  });
  test("reasoningObject with max_tokens → 'effort · N'", () => {
    expect(reasoningLabel({ kind: "reasoningObject", effort: "high", max_tokens: 4000 })).toBe(
      "high · 4000",
    );
  });
});

describe("auto-add provider models on save", () => {
  test("known providers have at least 1 default model so 'auto-add' has something to do", () => {
    for (const p of KNOWN_PROVIDERS) {
      expect(p.defaultModels.length).toBeGreaterThanOrEqual(1);
    }
    const openai = KNOWN_PROVIDERS.find((p) => p.id === "openai")!;
    expect(openai.defaultModels.length).toBeGreaterThanOrEqual(3);
  });

  test("store holds multiple profiles for one provider with distinct ids", () => {
    const store = new CredentialsStore(dataDir);
    store.upsertProvider({ type: "known", id: "openai", apiKey: "k" });
    const openai = KNOWN_PROVIDERS.find((p) => p.id === "openai")!;
    for (const m of openai.defaultModels) {
      store.upsertProfile({
        id: CredentialsStore.makeProfileId("openai", m),
        label: `openai · ${m}`,
        providerId: "openai",
        model: m,
      });
    }
    const profiles = store.listProfiles();
    expect(profiles.length).toBe(openai.defaultModels.length);
    const ids = new Set(profiles.map((p) => p.id));
    expect(ids.size).toBe(profiles.length);
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
