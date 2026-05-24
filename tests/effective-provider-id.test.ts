import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { effectiveProviderId } from "../src/agent/credentials.ts";
import { CredentialsStore } from "../src/agent/credentials.ts";
import { pickModel } from "../src/agent/model-picker.ts";
import { ModelCatalog } from "../src/agent/model-catalog.ts";
import type { ProjectConfig } from "../src/agent/project-config.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-eff-"));
});

afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

describe("effectiveProviderId — MiMo routing", () => {
  test("known provider id passes through", () => {
    expect(effectiveProviderId("mimo", { type: "known", id: "mimo" })).toBe("mimo");
  });

  test("explicit adapter: mimo wins", () => {
    expect(
      effectiveProviderId("custom-anything", {
        type: "custom",
        id: "custom-anything",
        adapter: "mimo",
        baseURL: "https://wherever.example/v1",
      }),
    ).toBe("mimo");
  });

  test("basedOn: mimo wins", () => {
    expect(
      effectiveProviderId("custom-xyz", {
        type: "custom",
        id: "custom-xyz",
        basedOn: "mimo",
        baseURL: "https://example.com/v1",
      }),
    ).toBe("mimo");
  });

  test("xiaomimimo.com baseURL heuristic resolves untagged custom providers", () => {
    expect(
      effectiveProviderId("custom-xiaomi-mimo", {
        type: "custom",
        id: "custom-xiaomi-mimo",
        baseURL: "https://token-plan-sgp.xiaomimimo.com/v1",
        apiKey: "k",
      }),
    ).toBe("mimo");
  });

  test("mimo-prefixed model name heuristic also resolves untagged providers", () => {
    expect(
      effectiveProviderId(
        "custom-proxy",
        {
          type: "custom",
          id: "custom-proxy",
          baseURL: "https://example.com/v1",
          apiKey: "k",
        },
        "mimo-v2.5-pro",
      ),
    ).toBe("mimo");
  });

  test("non-mimo custom provider stays as itself", () => {
    expect(
      effectiveProviderId(
        "custom-moonshot",
        {
          type: "custom",
          id: "custom-moonshot",
          baseURL: "https://api.moonshot.ai/v1",
          apiKey: "k",
        },
        "kimi-k2.6",
      ),
    ).toBe("custom-moonshot");
  });
});

describe("pickModel + catalog routing", () => {
  function seedMimoCatalog(): void {
    fs.writeFileSync(
      path.join(dataDir, "model-catalog.json"),
      JSON.stringify({
        fetched_at: Date.now(),
        source: "test",
        entries: {
          "mimo/mimo-v2.5-pro": {
            providerId: "mimo",
            id: "mimo-v2.5-pro",
            name: "MiMo v2.5 Pro",
            context: 1_048_576,
            output: 131_072,
            tool_call: true,
            reasoning: true,
            cost: { input: 1, output: 3, cache_read: 0.2 },
          },
        },
      }),
    );
  }

  test("a custom-xiaomi-mimo provider hits MiMo catalog entries via the heuristic", async () => {
    seedMimoCatalog();
    const creds = new CredentialsStore(dataDir);
    creds.upsertProvider({
      type: "custom",
      id: "custom-xiaomi-mimo",
      baseURL: "https://token-plan-sgp.xiaomimimo.com/v1",
      apiKey: "k",
    });
    creds.upsertProfile({
      id: "p1",
      label: "custom-xiaomi-mimo · mimo-v2.5-pro · high",
      providerId: "custom-xiaomi-mimo",
      model: "mimo-v2.5-pro",
      reasoning: { kind: "effort", effort: "high" },
    });
    creds.setActive("p1");

    process.env.GLORP_DISABLE_CATALOG_REFRESH = "1";
    const picked = await pickModel({ credentials: creds, catalog: new ModelCatalog(dataDir) });
    expect(picked.contextLimit).toBe(1_048_576);
    expect(picked.modelInfo?.tool_call).toBe(true);
    expect(picked.modelInfo?.cost?.input).toBe(1);
    delete process.env.GLORP_DISABLE_CATALOG_REFRESH;
  });

  test("explicit adapter: mimo also routes (custom-xiaomi-grant case)", async () => {
    seedMimoCatalog();
    const creds = new CredentialsStore(dataDir);
    creds.upsertProvider({
      type: "custom",
      id: "custom-xiaomi-grant",
      adapter: "mimo",
      baseURL: "https://token-plan-sgp.xiaomimimo.com/v1",
      apiKey: "k",
    });
    creds.upsertProfile({
      id: "p1",
      label: "custom-xiaomi-grant · mimo-v2.5-pro · high",
      providerId: "custom-xiaomi-grant",
      model: "mimo-v2.5-pro",
      reasoning: { kind: "effort", effort: "high" },
    });
    creds.setActive("p1");

    process.env.GLORP_DISABLE_CATALOG_REFRESH = "1";
    const picked = await pickModel({ credentials: creds, catalog: new ModelCatalog(dataDir) });
    expect(picked.contextLimit).toBe(1_048_576);
    delete process.env.GLORP_DISABLE_CATALOG_REFRESH;
  });

  test("project-config override beats catalog (the user's glorp.json scenario)", async () => {
    seedMimoCatalog();
    const creds = new CredentialsStore(dataDir);
    creds.upsertProvider({
      type: "custom",
      id: "custom-xiaomi-mimo",
      baseURL: "https://token-plan-sgp.xiaomimimo.com/v1",
      apiKey: "k",
    });
    creds.upsertProfile({
      id: "p1",
      label: "custom-xiaomi-mimo · mimo-v2.5-pro",
      providerId: "custom-xiaomi-mimo",
      model: "mimo-v2.5-pro",
    });
    creds.setActive("p1");

    const projectConfig: ProjectConfig = {
      provider: {
        "custom-xiaomi-mimo": {
          models: {
            "mimo-v2.5-pro": { contextLimit: 2_000_000, cost: { input: 0.5 } },
          },
        },
      },
    };

    process.env.GLORP_DISABLE_CATALOG_REFRESH = "1";
    const picked = await pickModel({
      credentials: creds,
      catalog: new ModelCatalog(dataDir),
      projectConfig,
    });
    expect(picked.contextLimit).toBe(2_000_000);
    expect(picked.modelInfo?.cost?.input).toBe(0.5);
    expect(picked.modelInfo?.cost?.output).toBe(3); // preserved from catalog
    delete process.env.GLORP_DISABLE_CATALOG_REFRESH;
  });
});
