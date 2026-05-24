import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { CredentialsStore } from "../src/agent/credentials.ts";
import { pickModel } from "../src/agent/model-picker.ts";
import { ModelCatalog } from "../src/agent/model-catalog.ts";
import type { ProjectConfig } from "../src/agent/project-config.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-var-"));
});

afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

function offlineCatalog(): ModelCatalog {
  return new ModelCatalog(dataDir, {
    fetchImpl: (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
  });
}

function setupZiomiProfile(creds: CredentialsStore, variantName?: string): void {
  creds.upsertProvider({
    type: "custom",
    id: "ziomi",
    adapter: "openai-compat",
    baseURL: "https://ziomi.example/v1",
    apiKey: "k",
    contextLimit: 200_000,
  });
  creds.upsertProfile({
    id: "p1",
    label: "ziomi · ziomi-1",
    providerId: "ziomi",
    model: "ziomi-1",
    variantName,
  });
  creds.setActive("p1");
}

const VARIANTS_CONFIG: ProjectConfig = {
  provider: {
    ziomi: {
      models: {
        "ziomi-1": {
          variants: {
            high: { reasoning: { kind: "effort", effort: "high" }, outputLimit: 32_000 },
            low: { reasoning: { kind: "effort", effort: "low" } },
          },
        },
      },
    },
  },
};

describe("pickModel — variants", () => {
  test("no variantName leaves profile reasoning untouched", async () => {
    const creds = new CredentialsStore(dataDir);
    setupZiomiProfile(creds);
    creds.upsertProfile({
      ...creds.getProfile("p1")!,
      reasoning: { kind: "effort", effort: "medium" },
    });

    const picked = await pickModel({
      credentials: creds,
      catalog: offlineCatalog(),
      projectConfig: VARIANTS_CONFIG,
    });
    // Label includes the active reasoning but no variant suffix.
    expect(picked.label).toContain("medium");
    expect(picked.label).not.toContain("high");
    expect(picked.label).not.toContain("low");
  });

  test("active variantName overlays its reasoning and outputLimit", async () => {
    const creds = new CredentialsStore(dataDir);
    setupZiomiProfile(creds, "high");
    creds.upsertProfile({
      ...creds.getProfile("p1")!,
      reasoning: { kind: "effort", effort: "medium" },
    });

    const picked = await pickModel({
      credentials: creds,
      catalog: offlineCatalog(),
      projectConfig: VARIANTS_CONFIG,
    });
    // Variant's reasoning wins over the stored profile reasoning.
    expect(picked.label).toContain("high");
    expect(picked.label).not.toContain("medium");
    // outputLimit landed on the picked info.
    expect(picked.modelInfo?.output).toBe(32_000);
  });

  test("stale variantName (variant deleted from config) falls back gracefully", async () => {
    const creds = new CredentialsStore(dataDir);
    setupZiomiProfile(creds, "removed-variant");
    creds.upsertProfile({
      ...creds.getProfile("p1")!,
      reasoning: { kind: "effort", effort: "medium" },
    });

    const picked = await pickModel({
      credentials: creds,
      catalog: offlineCatalog(),
      projectConfig: VARIANTS_CONFIG,
    });
    expect(picked.label).toContain("medium");
  });

  test("variant context still respects per-profile contextLimit", async () => {
    const creds = new CredentialsStore(dataDir);
    setupZiomiProfile(creds, "high");
    creds.upsertProfile({
      ...creds.getProfile("p1")!,
      contextLimit: 500_000,
    });
    const picked = await pickModel({
      credentials: creds,
      catalog: offlineCatalog(),
      projectConfig: VARIANTS_CONFIG,
    });
    expect(picked.contextLimit).toBe(500_000);
    // The variant's outputLimit is still applied independently.
    expect(picked.modelInfo?.output).toBe(32_000);
  });
});
