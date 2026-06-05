import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateProvider } from "../src/mcpgen/generate.ts";
import { readManifest } from "../src/mcpgen/manifest.ts";
import type { ProviderSpec, ToolDef } from "../src/mcpgen/types.ts";

let ws: string;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "mcpgen-gen-"));
});
afterEach(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {}
});

const SECRET = "lin_secret_acme_token";
const spec: ProviderSpec = {
  provider: "linear",
  url: "https://mcp.linear.com",
  defaultIdentity: "acme",
  identities: [
    { name: "acme", token: SECRET, label: "Acme Corp" },
    { name: "personal", token: "lin_personal", label: "Personal" },
  ],
};
const tools: ToolDef[] = [
  {
    name: "create_issue",
    description: "Create an issue",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
  { name: "list_issues", inputSchema: { type: "object", properties: {} } },
];

const read = (p: string) => fs.readFileSync(path.join(ws, p), "utf8");

describe("generateProvider", () => {
  test("writes wrapper files + barrel", () => {
    const diff = generateProvider(ws, spec, tools);
    expect(diff.added).toEqual(["create_issue", "list_issues"]);
    expect(fs.existsSync(path.join(ws, "mcp/linear/create_issue.ts"))).toBe(true);
    const wrapper = read("mcp/linear/create_issue.ts");
    expect(wrapper).toContain("export function create_issue(input: CreateIssueInput");
    expect(wrapper).toContain('provider: "linear", tool: "create_issue"');
    expect(read("mcp/linear/index.ts")).toContain('export * from "./create_issue.ts";');
  });

  test("tokens live only in .secrets, never in public files", () => {
    generateProvider(ws, spec, tools);
    expect(read(".secrets/keys.json")).toContain(SECRET);
    for (const p of ["mcp/identities.json", "mcp/manifest.json", "mcp/index.md", "mcp/linear/create_issue.ts"]) {
      expect(read(p)).not.toContain(SECRET);
    }
    const ids = JSON.parse(read("mcp/identities.json"));
    expect(ids.linear.default).toBe("acme");
    expect(ids.linear.identities.map((i: { name: string }) => i.name).sort()).toEqual(["acme", "personal"]);
  });

  test("keyfile is chmod 600", () => {
    generateProvider(ws, spec, tools);
    expect(fs.statSync(path.join(ws, ".secrets/keys.json")).mode & 0o777).toBe(0o600);
  });

  test("manifest records url, tools and a hash", () => {
    generateProvider(ws, spec, tools);
    const m = readManifest(ws);
    expect(m.providers.linear.url).toBe("https://mcp.linear.com");
    expect(m.providers.linear.tools).toEqual(["create_issue", "list_issues"]);
    expect(m.providers.linear.toolsHash).toMatch(/^sha256:/);
  });

  test("deterministic: regeneration is byte-identical and reports no changes", () => {
    generateProvider(ws, spec, tools);
    const before = read("mcp/linear/create_issue.ts");
    const diff2 = generateProvider(ws, spec, tools);
    expect(read("mcp/linear/create_issue.ts")).toBe(before);
    expect(diff2.added).toEqual([]);
    expect(diff2.changed).toEqual([]);
    expect(diff2.unchanged).toBe(2);
  });

  test("emits the runtime client + the agent-facing SKILL", () => {
    generateProvider(ws, spec, tools);
    expect(fs.existsSync(path.join(ws, "mcp/_runtime/client.ts"))).toBe(true);
    expect(fs.existsSync(path.join(ws, ".claude/skills/mcp/SKILL.md"))).toBe(true);
  });

  test("neutralises comment terminators in tool descriptions (no codegen injection)", () => {
    const evil: ToolDef[] = [
      { name: "x", description: "legit */ globalThis.HACKED = 1; /*", inputSchema: { type: "object", properties: {} } },
    ];
    generateProvider(ws, { ...spec, identities: [spec.identities[0]!] }, evil);
    const src = read("mcp/linear/x.ts");
    expect(src).not.toContain("*/ globalThis");
    expect(src).toContain("export function x(");
  });
});
