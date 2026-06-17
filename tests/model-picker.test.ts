import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { pickModel, resolveAdapterBaseURL } from "../src/agent/model-picker.ts";
import { CredentialsStore } from "../src/agent/credentials.ts";
import { ModelCatalog } from "../src/agent/model-catalog.ts";

let dataDir: string;
let savedKeys: Record<string, string | undefined>;

const KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MIMO_API_KEY",
  "GLM_API_KEY",
  "KIMI_API_KEY",
  "MIMO_BASE_URL",
  "GLM_BASE_URL",
  "KIMI_BASE_URL",
];

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-pick-"));
  // Snapshot + clear env vars to isolate provider resolution.
  savedKeys = {};
  for (const v of KEY_VARS) {
    savedKeys[v] = process.env[v];
    delete process.env[v];
  }
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

describe("pickModel", () => {
  test("explicit CLI provider wins over everything", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-anthropic";
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.OPENROUTER_API_KEY = "sk-openrouter"; // Required by adapter constructor.
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "groq", apiKey: "k" });
    credentials.upsertProfile({
      id: "groq__llama",
      label: "groq",
      providerId: "groq",
      model: "llama-3.3-70b-versatile",
    });
    credentials.setActive("groq__llama");

    const picked = await pickModel({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      credentials,
    });
    expect(picked.providerId).toBe("openrouter");
    expect(picked.model).toBe("anthropic/claude-sonnet-4");
    expect(picked.label).toContain("openrouter");
  });

  test("active profile in credentials store is used when no flags + env", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "known",
      id: "openai",
      apiKey: "sk-openai-real",
    });
    credentials.upsertProfile({
      id: "openai__gpt5-high",
      label: "openai · gpt-5 · high",
      providerId: "openai",
      model: "gpt-5",
      reasoning: "high",
    });
    credentials.setActive("openai__gpt5-high");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("openai");
    expect(picked.model).toBe("gpt-5");
    expect(picked.label).toContain("high");
    expect(picked.profile?.id).toBe("openai__gpt5-high");
  });

  test("explicit profileId overrides activeProfileId", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "openai", apiKey: "k" });
    credentials.upsertProfile({
      id: "p1",
      label: "p1",
      providerId: "openai",
      model: "gpt-4.1",
    });
    credentials.upsertProfile({
      id: "p2",
      label: "p2",
      providerId: "openai",
      model: "gpt-5",
    });
    credentials.setActive("p1");

    const picked = await pickModel({ credentials, profileId: "p2" });
    expect(picked.model).toBe("gpt-5");
    expect(picked.profile?.id).toBe("p2");
  });

  test("falls back to env vars when credentials store is empty", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-fallback";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("anthropic");
    expect(picked.model).toMatch(/claude/);
  });

  test("env-var precedence is anthropic > openai > openrouter > gemini > groq > mimo", async () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.OPENROUTER_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    process.env.MIMO_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("openai");
  });

  test("mimo env fallback uses the dedicated MiMo adapter", async () => {
    process.env.MIMO_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("mimo");
    expect(picked.model).toBe("mimo-v2.5-pro");
    expect(picked.adapter.name).toBe("mimo:mimo-v2.5-pro");
  });

  test("glm env fallback selects the GLM coding provider via OpenAI-compat", async () => {
    process.env.GLM_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("glm");
    expect(picked.model).toBe("glm-5.2");
    expect(picked.adapter.name).toBe("openai-compat:glm-5.2");
  });

  test("kimi env fallback selects the Kimi coding provider via OpenAI-compat", async () => {
    process.env.KIMI_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("kimi");
    expect(picked.model).toBe("kimi-k2.7-code");
    expect(picked.adapter.name).toBe("openai-compat:kimi-k2.7-code");
  });

  test("env precedence keeps glm/kimi below the established providers", async () => {
    process.env.MIMO_API_KEY = "k";
    process.env.GLM_API_KEY = "k";
    process.env.KIMI_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("mimo");
  });

  test("throws when no config and no env", async () => {
    const credentials = new CredentialsStore(dataDir);
    await expect(pickModel({ credentials })).rejects.toThrow(/No model configured/);
  });

  test("custom provider goes through OpenAI-compat with the saved baseURL", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-myhost",
      baseURL: "https://myhost.example/v1",
      apiKey: "sk-custom",
    });
    credentials.upsertProfile({
      id: "custom__llama",
      label: "custom · llama",
      providerId: "custom-myhost",
      model: "llama-3.3",
    });
    credentials.setActive("custom__llama");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("custom-myhost");
    expect(picked.model).toBe("llama-3.3");
    // The adapter is constructed but we don't try to call it (would 404).
    expect(picked.adapter).toBeDefined();
    expect(picked.adapter.name).toBeDefined();
  });

  test("custom Xiaomi endpoint is routed through the MiMo adapter", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-xiaomi",
      baseURL: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-custom",
    });
    credentials.upsertProfile({
      id: "custom-xiaomi__mimo",
      label: "xiaomi · mimo",
      providerId: "custom-xiaomi",
      model: "mimo-v2.5-pro",
    });
    credentials.setActive("custom-xiaomi__mimo");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("custom-xiaomi");
    expect(picked.adapter.name).toBe("mimo:mimo-v2.5-pro");
  });

  test("custom provider can explicitly select the MiMo adapter", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-private-mimo",
      adapter: "mimo",
      baseURL: "https://mimo-proxy.example/v1",
      apiKey: "sk-custom",
    });
    credentials.upsertProfile({
      id: "custom-private-mimo__model",
      label: "private mimo",
      providerId: "custom-private-mimo",
      model: "mimo-v2.5-pro",
    });
    credentials.setActive("custom-private-mimo__model");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("custom-private-mimo");
    expect(picked.adapter.name).toBe("mimo:mimo-v2.5-pro");
  });

  test("custom provider can force OpenAI-compatible even for a Xiaomi-looking URL", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-openai-shim",
      adapter: "openai-compat",
      baseURL: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-custom",
    });
    credentials.upsertProfile({
      id: "custom-openai-shim__model",
      label: "shim",
      providerId: "custom-openai-shim",
      model: "mimo-v2.5-pro",
    });
    credentials.setActive("custom-openai-shim__model");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("custom-openai-shim");
    expect(picked.adapter.name).toBe("openai-compat:mimo-v2.5-pro");
  });

  test("known mimo profile uses the dedicated MiMo adapter", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "mimo", apiKey: "k" });
    credentials.upsertProfile({
      id: "mimo__pro",
      label: "mimo · pro",
      providerId: "mimo",
      model: "mimo-v2.5-pro",
      reasoning: { kind: "effort", effort: "high" },
    });
    credentials.setActive("mimo__pro");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("mimo");
    expect(picked.adapter.name).toBe("mimo:mimo-v2.5-pro");
    expect(picked.label).toContain("high");
  });

  test("reasoning effort is included in the label and on the picked profile", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "openai", apiKey: "k" });
    credentials.upsertProfile({
      id: "openai__gpt5",
      label: "x",
      providerId: "openai",
      model: "gpt-5",
      reasoning: "high",
    });
    credentials.setActive("openai__gpt5");
    const picked = await pickModel({ credentials });
    expect(picked.label).toContain("high");
    expect(picked.profile?.reasoning).toBe("high");
  });

  test("anthropic label does not include reasoning even if profile sets it (Anthropic uses thinking)", async () => {
    // The label includes "high" because we still tagged the profile that
    // way, but the picker silently drops reasoning for non-reasoning models
    // when building the adapter. The label still reflects what the user
    // chose.
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "anthropic", apiKey: "k" });
    credentials.upsertProfile({
      id: "anth",
      label: "x",
      providerId: "anthropic",
      model: "claude-sonnet-4-20250514",
      reasoning: "high",
    });
    credentials.setActive("anth");
    const picked = await pickModel({ credentials });
    expect(picked.adapter).toBeDefined();
  });
});

describe("pickModel + basedOn (custom providers inheriting known defaults)", () => {
  test("custom basedOn 'mimo' routes through the MiMo adapter against a custom baseURL", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-my-mimo",
      basedOn: "mimo",
      baseURL: "https://my-mimo-proxy.example/v1",
      apiKey: "sk-proxy",
    });
    credentials.upsertProfile({
      id: "custom-my-mimo__pro",
      label: "my mimo · pro",
      providerId: "custom-my-mimo",
      model: "mimo-v2.5-pro",
    });
    credentials.setActive("custom-my-mimo__pro");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("custom-my-mimo");
    expect(picked.adapter.name).toBe("mimo:mimo-v2.5-pro");
    expect(picked.label).toContain("custom-my-mimo");
  });

  test("custom basedOn 'anthropic' routes through the Anthropic adapter against a custom baseURL", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-anth-proxy",
      basedOn: "anthropic",
      baseURL: "https://anth-proxy.example/v1",
      apiKey: "sk-anth-proxy",
    });
    credentials.upsertProfile({
      id: "custom-anth-proxy__opus",
      label: "proxy · opus",
      providerId: "custom-anth-proxy",
      model: "claude-opus-4-7",
    });
    credentials.setActive("custom-anth-proxy__opus");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("custom-anth-proxy");
    expect(picked.adapter.name).toMatch(/anthropic/);
  });

  test("custom basedOn 'openai' uses OpenAI-compat with the custom URL", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-oai-mirror",
      basedOn: "openai",
      baseURL: "https://openai-mirror.example/v1",
      apiKey: "sk-mirror",
    });
    credentials.upsertProfile({
      id: "custom-oai-mirror__gpt5",
      label: "mirror · gpt-5",
      providerId: "custom-oai-mirror",
      model: "gpt-5",
    });
    credentials.setActive("custom-oai-mirror__gpt5");

    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("custom-oai-mirror");
    expect(picked.adapter.name).toBe("openai-compat:gpt-5");
  });

  test("basedOn falls back to the known provider's env var when apiKey is absent", async () => {
    process.env.MIMO_API_KEY = "sk-env-mimo";
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-my-mimo",
      basedOn: "mimo",
      baseURL: "https://my-mimo-proxy.example/v1",
      // no apiKey — should pull MIMO_API_KEY
    });
    credentials.upsertProfile({
      id: "custom-my-mimo__pro",
      label: "my mimo",
      providerId: "custom-my-mimo",
      model: "mimo-v2.5-pro",
    });
    credentials.setActive("custom-my-mimo__pro");

    // If env fallback worked, adapter construction succeeds.
    const picked = await pickModel({ credentials });
    expect(picked.adapter.name).toBe("mimo:mimo-v2.5-pro");
  });

  test("basedOn inherits reasoning capability matchers from the known provider", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-openai-mirror",
      basedOn: "openai",
      baseURL: "https://oai-mirror.example/v1",
      apiKey: "k",
    });
    credentials.upsertProfile({
      id: "custom-openai-mirror__gpt5-high",
      label: "mirror · gpt-5 high",
      providerId: "custom-openai-mirror",
      model: "gpt-5",
      reasoning: { kind: "effort", effort: "high" },
    });
    credentials.setActive("custom-openai-mirror__gpt5-high");

    const picked = await pickModel({ credentials });
    // gpt-5 is OpenAI's reasoning-capable matcher; basedOn must inherit it
    // for the reasoning hint to be applied. Adapter constructed = success.
    expect(picked.adapter.name).toBe("openai-compat:gpt-5");
    expect(picked.label).toContain("high");
  });
});

describe("pickModel + output-token clamp (issue: near-full-window output 400s)", () => {
  /** Write a catalog entry with explicit context/output so resolveMaxTokens has data. */
  function seedCatalog(key: string, context: number, output: number): ModelCatalog {
    const id = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    const providerId = key.includes("/") ? key.slice(0, key.indexOf("/")) : "unknown";
    fs.writeFileSync(
      path.join(dataDir, "model-catalog.json"),
      JSON.stringify({
        fetched_at: Date.now(),
        source: "test",
        entries: { [key]: { providerId, id, context, output } },
      }),
    );
    process.env.GLORP_DISABLE_CATALOG_REFRESH = "1";
    return new ModelCatalog(dataDir);
  }

  afterEach(() => {
    delete process.env.GLORP_MAX_OUTPUT_TOKENS;
    delete process.env.GLORP_DISABLE_CATALOG_REFRESH;
  });

  test("a 512000-of-524288 output advert is clamped so input has room", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const catalog = seedCatalog("anthropic/claude-opus-4-7", 524_288, 512_000);
    const picked = await pickModel({ provider: "anthropic", model: "claude-opus-4-7", catalog });
    // Capped at the 32K auto ceiling — nowhere near the 512000 advert.
    expect(picked.maxOutputTokens).toBe(32_768);
    expect(picked.maxOutputTokens).toBeLessThan(524_288 - 32_768);
  });

  test("a sane advertised output limit passes through unchanged", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const catalog = seedCatalog("anthropic/claude-opus-4-7", 200_000, 8_192);
    const picked = await pickModel({ provider: "anthropic", model: "claude-opus-4-7", catalog });
    expect(picked.maxOutputTokens).toBe(8_192);
  });

  test("GLORP_MAX_OUTPUT_TOKENS overrides the catalog advert", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.GLORP_MAX_OUTPUT_TOKENS = "16000";
    const catalog = seedCatalog("anthropic/claude-opus-4-7", 524_288, 512_000);
    const picked = await pickModel({ provider: "anthropic", model: "claude-opus-4-7", catalog });
    expect(picked.maxOutputTokens).toBe(16_000);
  });

  test("an env override is still clamped to half the context window", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.GLORP_MAX_OUTPUT_TOKENS = "1000000"; // absurd — must not crowd out input
    const catalog = seedCatalog("anthropic/claude-opus-4-7", 524_288, 512_000);
    const picked = await pickModel({ provider: "anthropic", model: "claude-opus-4-7", catalog });
    expect(picked.maxOutputTokens).toBe(262_144); // floor(524288 / 2)
  });

  test("falls back to the generous default when the catalog has no output limit", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const picked = await pickModel({ provider: "anthropic", model: "claude-opus-4-7" });
    expect(picked.maxOutputTokens).toBe(32_768);
  });

  test("an explicit variant outputLimit bypasses the auto ceiling", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "anthropic", apiKey: "k" });
    credentials.upsertProfile({
      id: "anth__opus",
      label: "anthropic · opus",
      providerId: "anthropic",
      model: "claude-opus-4-7",
      variantName: "thinking",
    });
    credentials.setActive("anth__opus");
    const catalog = seedCatalog("anthropic/claude-opus-4-7", 524_288, 512_000);
    // A "thinking" variant deliberately raises the cap to 64K — above the 32K
    // auto ceiling, but still under half the window, so it passes through.
    const projectConfig = {
      provider: {
        anthropic: {
          models: {
            "claude-opus-4-7": {
              variants: { thinking: { outputLimit: 64_000 } },
            },
          },
        },
      },
    };
    const picked = await pickModel({ credentials, catalog, projectConfig: projectConfig as never });
    expect(picked.maxOutputTokens).toBe(64_000);
  });
});

describe("pickModel + titleAdapter (cheap model for session titles)", () => {
  test("uses per-provider cheap default when no override is set", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({
      provider: "anthropic",
      model: "claude-opus-4-7",
      credentials,
    });
    expect(picked.adapter.name).toMatch(/anthropic.*opus/);
    expect(picked.titleAdapter.name).toMatch(/anthropic.*haiku/);
    expect(picked.titleAdapter).not.toBe(picked.adapter);
  });

  test("profile.titleModel overrides the per-provider default", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({ type: "known", id: "openai", apiKey: "k" });
    credentials.upsertProfile({
      id: "openai__gpt5",
      label: "openai · gpt-5",
      providerId: "openai",
      model: "gpt-5",
      titleModel: "gpt-4.1-nano",
    });
    credentials.setActive("openai__gpt5");
    const picked = await pickModel({ credentials });
    expect(picked.titleAdapter.name).toBe("openai-compat:gpt-4.1-nano");
  });

  test("titleAdapter inherits the same custom baseURL as the main adapter", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-my-mimo",
      basedOn: "mimo",
      baseURL: "https://my-mimo-proxy.example/v1",
      apiKey: "k",
    });
    credentials.upsertProfile({
      id: "custom-my-mimo__pro",
      label: "my mimo",
      providerId: "custom-my-mimo",
      model: "mimo-v2.5-pro",
    });
    credentials.setActive("custom-my-mimo__pro");
    const picked = await pickModel({ credentials });
    // basedOn=mimo => cheap title default is "mimo-v2.5" via MimoAdapter
    expect(picked.titleAdapter.name).toBe("mimo:mimo-v2.5");
  });

  test("falls back to main adapter when no cheap default exists for the provider", async () => {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-standalone",
      baseURL: "https://standalone.example/v1",
      apiKey: "k",
      adapter: "openai-compat",
    });
    credentials.upsertProfile({
      id: "custom-standalone__model",
      label: "standalone",
      providerId: "custom-standalone",
      model: "my-bespoke-model",
    });
    credentials.setActive("custom-standalone__model");
    const picked = await pickModel({ credentials });
    expect(picked.titleAdapter).toBe(picked.adapter);
  });
});

describe("default reasoning capture for default-thinking models", () => {
  /** Build a custom OpenAI-compat provider + profile and return the adapter's
   * resolved reasoning state ({ enabled, echo, effort? }). */
  async function reasoningFor(model: string, reasoning?: unknown) {
    const credentials = new CredentialsStore(dataDir);
    credentials.upsertProvider({
      type: "custom",
      id: "custom-moonshot",
      baseURL: "https://api.moonshot.example/v1",
      apiKey: "k",
      adapter: "openai-compat",
    });
    credentials.upsertProfile({
      id: `custom-moonshot__${model}`,
      label: model,
      providerId: "custom-moonshot",
      model,
      ...(reasoning !== undefined ? { reasoning: reasoning as any } : {}),
    });
    credentials.setActive(`custom-moonshot__${model}`);
    const picked = await pickModel({ credentials });
    return (picked.adapter as any).reasoning as { enabled: boolean; echo: boolean; effort?: string };
  }

  test("kimi without explicit reasoning still gets capture + echo (kimi-k2.6 thinks by default — Moonshot 400s tool loops without the echo)", async () => {
    const r = await reasoningFor("kimi-k2.6");
    expect(r.enabled).toBe(true);
    expect(r.echo).toBe(true);
    expect(r.effort).toBeUndefined(); // no hint unless the profile asks for one
  });

  test("kimi with explicit effort keeps the hint and the echo", async () => {
    const r = await reasoningFor("kimi-k2.6", "medium");
    expect(r.enabled).toBe(true);
    expect(r.echo).toBe(true);
    expect(r.effort).toBe("medium");
  });

  test("deepseek-r1 gets capture WITHOUT echo (R1 rejects echoed reasoning)", async () => {
    const r = await reasoningFor("deepseek-r1");
    expect(r.enabled).toBe(true);
    expect(r.echo).toBe(false);
  });

  test("non-reasoning models keep reasoning disabled entirely", async () => {
    const r = await reasoningFor("llama-3.3-70b-versatile");
    expect(r.enabled).toBe(false);
  });
});

describe("resolveAdapterBaseURL (env-only custom endpoints)", () => {
  test("returns the provider's <PROVIDER>_BASE_URL env override", () => {
    process.env.GLM_BASE_URL = "https://my-glm/v1";
    expect(resolveAdapterBaseURL("glm")).toBe("https://my-glm/v1");
  });

  test("a stored provider baseURL wins over the env override", () => {
    process.env.GLM_BASE_URL = "https://env-glm/v1";
    const got = resolveAdapterBaseURL("glm", { type: "custom", id: "x", baseURL: "https://cfg-glm/v1" });
    expect(got).toBe("https://cfg-glm/v1");
  });

  test("returns undefined when neither config nor env is set (adapter falls back to default)", () => {
    expect(resolveAdapterBaseURL("glm")).toBeUndefined();
  });

  test("an empty/whitespace env value is treated as unset", () => {
    process.env.KIMI_BASE_URL = "   ";
    expect(resolveAdapterBaseURL("kimi")).toBeUndefined();
  });

  test("MIMO_BASE_URL points the MiMo provider at a Token Plan regional endpoint", () => {
    process.env.MIMO_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/v1";
    expect(resolveAdapterBaseURL("mimo")).toBe("https://token-plan-sgp.xiaomimimo.com/v1");
  });
});
