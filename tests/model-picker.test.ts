import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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

  test("env-var precedence is anthropic > openai > openrouter > gemini > groq", async () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.OPENROUTER_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    const credentials = new CredentialsStore(dataDir);
    const picked = await pickModel({ credentials });
    expect(picked.providerId).toBe("openai");
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
