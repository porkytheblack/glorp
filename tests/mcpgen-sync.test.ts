import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { addProvider, removeProvider, syncAll, syncProvider } from "../src/mcpgen/workspace.ts";
import type { ProviderSpec, ToolDef } from "../src/mcpgen/types.ts";

let ws: string;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "mcpgen-sync-"));
});
afterEach(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {}
});

const spec: ProviderSpec = {
  provider: "linear",
  url: "https://mcp.linear.com",
  identities: [{ name: "acme", token: "t_acme" }],
};

const v1: ToolDef[] = [
  { name: "create_issue", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "archive_issue", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
];
const v2: ToolDef[] = [
  // create_issue gains a field (changed); archive_issue gone (removed); create_comment new (added)
  { name: "create_issue", inputSchema: { type: "object", properties: { title: { type: "string" }, teamId: { type: "string" } }, required: ["title"] } },
  { name: "create_comment", inputSchema: { type: "object", properties: { body: { type: "string" } } } },
];

const serve = (tools: ToolDef[]) => async () => tools;

describe("add + sync lifecycle", () => {
  test("computes add / remove / change diff and prunes removed files", async () => {
    const d1 = await addProvider(ws, spec, serve(v1));
    expect(d1.added).toEqual(["archive_issue", "create_issue"]);

    const d2 = await syncProvider(ws, "linear", serve(v2));
    expect(d2.added).toEqual(["create_comment"]);
    expect(d2.removed).toEqual(["archive_issue"]);
    expect(d2.changed).toEqual(["create_issue"]);
    expect(fs.existsSync(path.join(ws, "mcp/linear/archive_issue.ts"))).toBe(false);
    expect(fs.existsSync(path.join(ws, "mcp/linear/create_comment.ts"))).toBe(true);
  });

  test("sync-all is fail-soft per provider", async () => {
    await addProvider(ws, spec, serve(v1));
    const diffs = await syncAll(ws, async () => {
      throw new Error("server down");
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.error).toContain("server down");
  });

  test("removeProvider deletes the folder, manifest entry, keys and public docs", async () => {
    await addProvider(ws, spec, serve(v1));
    await addProvider(ws, { provider: "notion", url: "https://mcp.notion.com", identities: [{ name: "main", token: "n_tok" }] }, serve(v1));
    removeProvider(ws, "linear");
    expect(fs.existsSync(path.join(ws, "mcp/linear"))).toBe(false);
    const secret = JSON.parse(fs.readFileSync(path.join(ws, ".secrets/keys.json"), "utf8"));
    expect(secret.linear).toBeUndefined();
    const ids = JSON.parse(fs.readFileSync(path.join(ws, "mcp/identities.json"), "utf8"));
    expect(ids.linear).toBeUndefined();
    expect(ids.notion).toBeDefined();
  });

  test("rejects an invalid spec at the boundary", async () => {
    await expect(addProvider(ws, { provider: "x", url: "ftp://nope", identities: [{ name: "a", token: "t" }] }, serve(v1))).rejects.toThrow(/Invalid MCP url/);
    await expect(addProvider(ws, { provider: "x", url: "https://ok", identities: [] }, serve(v1))).rejects.toThrow(/at least one identity/);
  });
});
