/**
 * Garage MCP provisioning: createWorkspace minting + the workspace-scoped
 * /workspaces/:id/mcp route handlers, driven with an injected (no-network) lister.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SessionManager } from "../src/garage/manager.ts";
import { mcpRoutes } from "../src/garage/routes/mcp.ts";
import type { ToolDef, ToolLister } from "../src/mcpgen/index.ts";

const tmpDirs: string[] = [];
function tmp(prefix = "garage-mcp-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mgr() {
  const dataDir = tmp("data-");
  return new SessionManager({ dataDir, workspaceRoot: path.join(dataDir, "ws"), permissionMode: "normal" });
}

const TOOLS: ToolDef[] = [
  { name: "create_issue", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "list_issues", inputSchema: { type: "object", properties: {} } },
];
const lister: ToolLister = async () => TOOLS;

function addBody(): Request {
  return new Request("http://x/workspaces/ID/mcp", {
    method: "POST",
    body: JSON.stringify({
      provider: "linear",
      url: "https://mcp.linear.com",
      defaultIdentity: "acme",
      identities: [
        { name: "acme", token: "SECRET_acme", label: "Acme" },
        { name: "personal", token: "SECRET_personal" },
      ],
    }),
  });
}

describe("SessionManager.createWorkspace minting", () => {
  it("mints a managed folder under workspaceRoot when no path is given", () => {
    const m = mgr();
    const ws = m.createWorkspace({ name: "Acme MCP" });
    expect(ws.path).toContain(`${path.sep}ws${path.sep}`);
    expect(fs.existsSync(ws.path)).toBe(true);
    expect(ws.id).toMatch(/^ws_/);
  });
});

describe("MCP provisioning routes", () => {
  async function provisioned() {
    const m = mgr();
    const ws = m.createWorkspace({ name: "mcpws" });
    const routes = mcpRoutes(m, lister);
    const res = await routes.add(ws.id, addBody());
    return { m, ws, routes, res };
  }

  it("provisions a provider into the workspace and returns the diff", async () => {
    const { ws, res } = await provisioned();
    expect(res.status).toBe(201);
    const diff = (await res.json()) as { added: string[] };
    expect(diff.added.sort()).toEqual(["create_issue", "list_issues"]);
    expect(fs.existsSync(path.join(ws.path, "mcp/linear/create_issue.ts"))).toBe(true);
    expect(fs.existsSync(path.join(ws.path, ".claude/skills/mcp/SKILL.md"))).toBe(true);
  });

  it("keeps tokens only in .secrets, never in public files", async () => {
    const { ws } = await provisioned();
    expect(fs.readFileSync(path.join(ws.path, ".secrets/keys.json"), "utf8")).toContain("SECRET_acme");
    for (const p of ["mcp/identities.json", "mcp/manifest.json", "mcp/linear/create_issue.ts"]) {
      expect(fs.readFileSync(path.join(ws.path, p), "utf8")).not.toContain("SECRET_acme");
    }
  });

  it("lists installed providers without tokens", async () => {
    const { ws, routes } = await provisioned();
    const out = (await (await routes.list(ws.id)).json()) as any;
    expect(out.total).toBe(1);
    expect(out.providers[0].provider).toBe("linear");
    expect(out.providers[0].default_identity).toBe("acme");
    expect(out.providers[0].tools.sort()).toEqual(["create_issue", "list_issues"]);
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("syncs one provider with a new tool set and reports the diff", async () => {
    const { m, ws } = await provisioned();
    const v2: ToolDef[] = [
      { name: "create_issue", inputSchema: { type: "object", properties: { title: { type: "string" }, teamId: { type: "string" } }, required: ["title"] } },
      { name: "create_comment", inputSchema: { type: "object", properties: {} } },
    ];
    const res = await mcpRoutes(m, async () => v2).syncOne(ws.id, "linear");
    const diff = (await res.json()) as { added: string[]; removed: string[]; changed: string[] };
    expect(diff.added).toEqual(["create_comment"]);
    expect(diff.removed).toEqual(["list_issues"]);
    expect(diff.changed).toEqual(["create_issue"]);
  });

  it("removes a provider", async () => {
    const { ws, routes } = await provisioned();
    const res = await routes.remove(ws.id, "linear");
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(ws.path, "mcp/linear"))).toBe(false);
  });

  it("404s for an unknown workspace and 400s for an invalid spec", async () => {
    const m = mgr();
    expect((await mcpRoutes(m, lister).add("ws_nope", addBody())).status).toBe(404);
    const ws = m.createWorkspace({ name: "x" });
    const bad = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ provider: "linear", url: "ftp://nope", identities: [{ name: "a", token: "t" }] }),
    });
    expect((await mcpRoutes(m, lister).add(ws.id, bad)).status).toBe(400);
  });
});
