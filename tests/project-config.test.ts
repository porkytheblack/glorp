import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  applyOverrides,
  interpolate,
  loadProjectConfig,
  variantsFor,
} from "../src/agent/project-config.ts";

let workspace: string;
let home: string;
let savedEnv: Record<string, string | undefined>;

const ENV_VARS = ["ZIOMI_TOKEN", "RANDOM_TEST_KEY"];

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-cfg-ws-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-cfg-home-"));
  savedEnv = {};
  for (const v of ENV_VARS) {
    savedEnv[v] = process.env[v];
    delete process.env[v];
  }
});

afterEach(() => {
  for (const v of ENV_VARS) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
});

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

describe("interpolate", () => {
  test("expands {env:VAR}", () => {
    process.env.ZIOMI_TOKEN = "secret-123";
    expect(interpolate("Bearer {env:ZIOMI_TOKEN}")).toBe("Bearer secret-123");
  });

  test("an unset env var becomes empty", () => {
    expect(interpolate("Bearer {env:UNSET_THING}")).toBe("Bearer ");
  });

  test("expands {file:PATH} and trims trailing whitespace", () => {
    const p = path.join(workspace, "secret.txt");
    fs.writeFileSync(p, "tok-from-file\n");
    expect(interpolate(`Bearer {file:${p}}`)).toBe("Bearer tok-from-file");
  });

  test("missing file becomes empty rather than throwing", () => {
    expect(interpolate("Bearer {file:/tmp/does-not-exist-xyz}")).toBe("Bearer ");
  });

  test("multiple substitutions in one string", () => {
    process.env.RANDOM_TEST_KEY = "k";
    const p = path.join(workspace, "url.txt");
    fs.writeFileSync(p, "https://x.example");
    const result = interpolate(`{file:${p}}/v1?k={env:RANDOM_TEST_KEY}`);
    expect(result).toBe("https://x.example/v1?k=k");
  });

  test("leaves non-prefix braces alone", () => {
    expect(interpolate("regular {curly} text")).toBe("regular {curly} text");
  });
});

describe("loadProjectConfig — layering and merge", () => {
  test("returns empty config when no files exist", () => {
    const config = loadProjectConfig(workspace, home);
    expect(config).toEqual({});
  });

  test("loads <workspace>/glorp.json", () => {
    writeFile(
      path.join(workspace, "glorp.json"),
      JSON.stringify({ model: "anthropic/claude-opus-4-7" }),
    );
    const config = loadProjectConfig(workspace, home);
    expect(config.model).toBe("anthropic/claude-opus-4-7");
  });

  test("workspace layer wins over home layer", () => {
    writeFile(path.join(home, ".glorp", "config.json"), JSON.stringify({ model: "home-pick" }));
    writeFile(path.join(workspace, "glorp.json"), JSON.stringify({ model: "ws-pick" }));
    const config = loadProjectConfig(workspace, home);
    expect(config.model).toBe("ws-pick");
  });

  test("provider overrides shallow-merge across layers", () => {
    writeFile(
      path.join(home, ".glorp", "config.json"),
      JSON.stringify({
        provider: { ziomi: { apiKey: "home-key", contextLimit: 100_000 } },
      }),
    );
    writeFile(
      path.join(workspace, "glorp.json"),
      JSON.stringify({
        provider: { ziomi: { baseURL: "https://ws.example/v1" } },
      }),
    );
    const config = loadProjectConfig(workspace, home);
    expect(config.provider?.ziomi?.apiKey).toBe("home-key");
    expect(config.provider?.ziomi?.contextLimit).toBe(100_000);
    expect(config.provider?.ziomi?.baseURL).toBe("https://ws.example/v1");
  });

  test("model overrides shallow-merge inside a provider", () => {
    writeFile(
      path.join(home, ".glorp", "config.json"),
      JSON.stringify({
        provider: {
          ziomi: {
            models: { "ziomi-1": { contextLimit: 200_000, cost: { input: 0.1, output: 0.5 } } },
          },
        },
      }),
    );
    writeFile(
      path.join(workspace, "glorp.json"),
      JSON.stringify({
        provider: {
          ziomi: {
            models: { "ziomi-1": { cost: { input: 0.25 } } },
          },
        },
      }),
    );
    const config = loadProjectConfig(workspace, home);
    const m = config.provider?.ziomi?.models?.["ziomi-1"];
    expect(m?.contextLimit).toBe(200_000);
    expect(m?.cost?.input).toBe(0.25);
    expect(m?.cost?.output).toBe(0.5); // preserved from home layer
  });

  test("interpolates env vars in apiKey", () => {
    process.env.ZIOMI_TOKEN = "shhh";
    writeFile(
      path.join(workspace, "glorp.json"),
      JSON.stringify({ provider: { ziomi: { apiKey: "{env:ZIOMI_TOKEN}" } } }),
    );
    const config = loadProjectConfig(workspace, home);
    expect(config.provider?.ziomi?.apiKey).toBe("shhh");
  });

  test("accepts JSONC (// and /* */ comments)", () => {
    writeFile(
      path.join(workspace, "glorp.json"),
      `{
        // workspace defaults
        "model": "anthropic/claude-opus-4-7" /* the default */
      }`,
    );
    const config = loadProjectConfig(workspace, home);
    expect(config.model).toBe("anthropic/claude-opus-4-7");
  });

  test("malformed JSON is ignored gracefully", () => {
    writeFile(path.join(workspace, "glorp.json"), "{ this is not json");
    const config = loadProjectConfig(workspace, home);
    expect(config).toEqual({});
  });
});

describe("applyOverrides", () => {
  const catalogInfo = {
    providerId: "ziomi",
    id: "ziomi-1",
    name: "Ziomi 1 (catalog)",
    context: 128_000,
    output: 8192,
    cost: { input: 1, output: 2 },
    tool_call: true,
  };

  test("returns the catalog entry untouched when there are no overrides", () => {
    const result = applyOverrides(catalogInfo, undefined, "ziomi", "ziomi-1");
    expect(result.context).toBe(128_000);
    expect(result.cost?.input).toBe(1);
  });

  test("model-level contextLimit wins over the catalog", () => {
    const result = applyOverrides(
      catalogInfo,
      { models: { "ziomi-1": { contextLimit: 200_000 } } },
      "ziomi",
      "ziomi-1",
    );
    expect(result.context).toBe(200_000);
  });

  test("provider-level contextLimit fills in when the catalog has none", () => {
    const result = applyOverrides(
      undefined,
      { contextLimit: 200_000 },
      "ziomi",
      "ziomi-1",
    );
    expect(result.context).toBe(200_000);
  });

  test("model cost merges with catalog cost", () => {
    const result = applyOverrides(
      catalogInfo,
      { models: { "ziomi-1": { cost: { input: 5 } } } },
      "ziomi",
      "ziomi-1",
    );
    expect(result.cost).toEqual({ input: 5, output: 2 });
  });

  test("capability flags override the catalog", () => {
    const result = applyOverrides(
      catalogInfo,
      { models: { "ziomi-1": { tool_call: false, attachment: true } } },
      "ziomi",
      "ziomi-1",
    );
    expect(result.tool_call).toBe(false);
    expect(result.attachment).toBe(true);
  });
});

describe("variantsFor", () => {
  test("returns variants in declaration order", () => {
    const config = {
      provider: {
        anthropic: {
          models: {
            "claude-opus-4-7": {
              variants: {
                high: { reasoning: { kind: "thinking", budget_tokens: 16384 } },
                low: { reasoning: { kind: "thinking", budget_tokens: 1024 } },
              },
            },
          },
        },
      },
    };
    const result = variantsFor(config, "anthropic", "claude-opus-4-7");
    expect(result.map((r) => r.name)).toEqual(["high", "low"]);
  });

  test("returns empty when none declared", () => {
    expect(variantsFor({}, "anthropic", "claude-opus-4-7")).toEqual([]);
  });
});
