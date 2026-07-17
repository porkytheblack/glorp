import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  autoConnectIds,
  mcpCatalogue,
  mcpToken,
  mergeMcpSections,
  type McpSection,
} from "../src/agent/mcp/config.ts";
import { loadProjectConfig } from "../src/agent/project-config.ts";

const SECTION: McpSection = {
  linear: { url: "https://mcp.linear.app/mcp", auth: "lin_123", description: "Linear", tags: ["issues"] },
  docs: { url: "https://docs.example.com/mcp" },
  disabled: { url: "https://off.example.com/mcp", enabled: false },
  manual: { url: "https://manual.example.com/mcp", autoConnect: false },
  broken: { url: "not-a-url" },
};

describe("mcpCatalogue", () => {
  test("includes enabled servers with http urls only", () => {
    const ids = mcpCatalogue(SECTION).map((e) => e.id);
    expect(ids).toEqual(["linear", "docs", "manual"]);
  });

  test("fills name/description defaults and keeps tags", () => {
    const linear = mcpCatalogue(SECTION).find((e) => e.id === "linear")!;
    expect(linear.name).toBe("linear");
    expect(linear.description).toBe("Linear");
    expect(linear.tags).toEqual(["issues"]);
    const docs = mcpCatalogue(SECTION).find((e) => e.id === "docs")!;
    expect(docs.description).toContain("docs.example.com");
    expect(docs.tags).toBeUndefined();
  });
});

describe("autoConnectIds", () => {
  test("excludes autoConnect:false and disabled servers", () => {
    expect(autoConnectIds(SECTION)).toEqual(["linear", "docs"]);
  });
});

describe("mcpToken", () => {
  test("returns the trimmed token or undefined", () => {
    expect(mcpToken(SECTION, "linear")).toBe("lin_123");
    expect(mcpToken(SECTION, "docs")).toBeUndefined();
    expect(mcpToken({ a: { url: "https://x", auth: "   " } }, "a")).toBeUndefined();
    expect(mcpToken(SECTION, "missing")).toBeUndefined();
  });
});

describe("mergeMcpSections", () => {
  test("higher layer wins per server, per field", () => {
    const merged = mergeMcpSections(
      { linear: { url: "https://old", auth: "base-token", tags: ["a"] } },
      { linear: { url: "https://new" }, extra: { url: "https://extra" } },
    );
    expect(merged.linear).toEqual({ url: "https://new", auth: "base-token", tags: ["a"] });
    expect(merged.extra).toEqual({ url: "https://extra" });
  });
});

describe("project config mcp layering", () => {
  let workspace: string;
  let home: string;
  let savedToken: string | undefined;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-mcp-ws-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-mcp-home-"));
    savedToken = process.env.GLORP_TEST_MCP_TOKEN;
    process.env.GLORP_TEST_MCP_TOKEN = "tok-from-env";
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env.GLORP_TEST_MCP_TOKEN;
    else process.env.GLORP_TEST_MCP_TOKEN = savedToken;
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  });

  test("merges mcp across layers with workspace winning and interpolates auth", () => {
    fs.mkdirSync(path.join(home, ".config", "glorp"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".config", "glorp", "config.json"),
      JSON.stringify({ mcp: {
        linear: { url: "https://home.example/mcp", auth: "{env:GLORP_TEST_MCP_TOKEN}" },
        homeonly: { url: "https://homeonly.example/mcp" },
      } }),
    );
    fs.writeFileSync(
      path.join(workspace, "glorp.json"),
      JSON.stringify({ mcp: { linear: { url: "https://ws.example/mcp" } } }),
    );

    const cfg = loadProjectConfig(workspace, home);
    expect(cfg.mcp?.linear?.url).toBe("https://ws.example/mcp");
    // auth comes from the home layer and is env-interpolated at load
    expect(cfg.mcp?.linear?.auth).toBe("tok-from-env");
    expect(cfg.mcp?.homeonly?.url).toBe("https://homeonly.example/mcp");
  });
});
