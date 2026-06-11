/**
 * Garage as a companion-service client (docs/companion-service-spec.md):
 * the remote template registry (ETag revalidation, last-known-good on
 * outage), the disk-shadows-registry merge, registry-resolved multi-file
 * skills, and end-to-end provisioning of a registry template.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startCompanionStub, type CompanionStub } from "./companion-stub.ts";
import { RemoteTemplateRegistry } from "../src/garage/templates/remote.ts";
import { compositeTemplateSource } from "../src/garage/templates/source.ts";
import { TemplateStore } from "../src/garage/templates/store.ts";
import { provision } from "../src/garage/templates/engine.ts";
import { GitTokenSource } from "../src/garage/git-tokens.ts";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const HEADERS = { authorization: "Bearer test-key" };

let stub: CompanionStub;
afterEach(() => stub?.close());

function registry(ttlMs = 60_000): RemoteTemplateRegistry {
  return new RemoteTemplateRegistry({ url: `${stub.url}/v1/templates`, headers: HEADERS }, ttlMs);
}

describe("RemoteTemplateRegistry", () => {
  it("lists registry templates and revalidates via ETag (304 keeps cache)", async () => {
    stub = startCompanionStub();
    stub.setTemplates([{ name: "svc-tmpl", system_prompt: "Hi." }]);
    const reg = registry(0); // always revalidate so we can observe the 304 path
    expect((await reg.list()).map((t) => t.name)).toEqual(["svc-tmpl"]);
    expect((await reg.list()).map((t) => t.name)).toEqual(["svc-tmpl"]); // 304 round
    expect(stub.listCount).toBe(2);
  });

  it("serves last known good through an outage, then recovers", async () => {
    stub = startCompanionStub();
    stub.setTemplates([{ name: "stable", system_prompt: "x" }]);
    const reg = registry(0);
    await reg.list();
    stub.down = true;
    expect((await reg.list()).map((t) => t.name)).toEqual(["stable"]);
    stub.down = false;
    stub.setTemplates([{ name: "stable" , system_prompt: "x" }, { name: "fresh", system_prompt: "y" }]);
    expect((await reg.list()).length).toBe(2);
  });

  it("skips invalid registry documents (no name / nothing to provision)", async () => {
    stub = startCompanionStub();
    stub.setTemplates([{ system_prompt: "nameless" }, { name: "empty" }, { name: "ok", system_prompt: "x" }]);
    expect((await registry().list()).map((t) => t.name)).toEqual(["ok"]);
  });

  it("falls back to the single-document endpoint on a cache miss", async () => {
    stub = startCompanionStub();
    stub.setTemplates([]);
    const reg = registry(); // fresh list cached as empty…
    await reg.list();
    stub.setTemplates([{ name: "late", system_prompt: "x" }]); // …then the registry gains one
    expect((await reg.get("late"))?.name).toBe("late"); // found via GET /v1/templates/late
    expect(await reg.get("never")).toBeUndefined();
  });

  it("401s without the service key (auth headers are required and sent)", async () => {
    stub = startCompanionStub();
    stub.setTemplates([{ name: "secret", system_prompt: "x" }]);
    const noAuth = new RemoteTemplateRegistry({ url: `${stub.url}/v1/templates` });
    expect(await noAuth.list()).toEqual([]); // 401 → no last-known-good yet
    expect((await registry().list()).length).toBe(1);
  });
});

describe("compositeTemplateSource", () => {
  it("disk shadows the registry on name collision", async () => {
    stub = startCompanionStub();
    stub.setTemplates([
      { name: "shared", system_prompt: "FROM REGISTRY" },
      { name: "registry-only", system_prompt: "r" },
    ]);
    const dir = tmp("tmpl-");
    fs.writeFileSync(path.join(dir, "shared.json"), JSON.stringify({ system_prompt: "FROM DISK" }));
    const source = compositeTemplateSource(new TemplateStore(dir), registry());
    const names = (await source.list()).map((t) => t.name);
    expect(names).toEqual(["registry-only", "shared"]);
    expect((await source.get("shared"))?.system_prompt).toBe("FROM DISK");
    expect(await source.has("registry-only")).toBe(true);
  });

  it("works without a registry configured", async () => {
    const dir = tmp("tmpl-");
    fs.writeFileSync(path.join(dir, "local.json"), JSON.stringify({ system_prompt: "x" }));
    const source = compositeTemplateSource(new TemplateStore(dir));
    expect((await source.list()).map((t) => t.name)).toEqual(["local"]);
    expect(await source.get("nope")).toBeUndefined();
  });
});

describe("registry-resolved skills (files form)", () => {
  it("materialises multi-file skills, confined, requiring SKILL.md", async () => {
    const ws = tmp("ws-");
    await provision(
      {
        name: "t",
        skills: [
          {
            name: "runbook",
            files: [
              { path: "SKILL.md", content: "---\nname: runbook\ndescription: d\n---\n\nBody {param:WHO}" },
              { path: "refs/checklist.md", content: "- step one" },
            ],
          },
        ],
      },
      { WHO: "ops" },
      ws,
      { templatesDir: "" },
    );
    expect(fs.readFileSync(path.join(ws, ".claude/skills/runbook/SKILL.md"), "utf-8")).toContain("Body ops");
    expect(fs.existsSync(path.join(ws, ".claude/skills/runbook/refs/checklist.md"))).toBe(true);
  });

  it("rejects files escaping the skill folder and skills without SKILL.md", async () => {
    const ws = tmp("ws-");
    await expect(
      provision(
        { name: "t", skills: [{ name: "evil", files: [{ path: "SKILL.md", content: "x" }, { path: "../../pwn", content: "x" }] }] },
        {},
        ws,
        { templatesDir: "" },
      ),
    ).rejects.toThrow(/escapes the skill folder/);
    await expect(
      provision({ name: "t", skills: [{ name: "bare", files: [{ path: "notes.md", content: "x" }] }] }, {}, ws, { templatesDir: "" }),
    ).rejects.toThrow(/no SKILL.md/);
  });
});

describe("token endpoint conformance (client side)", () => {
  it("pulls a repo-scoped token with auth headers and caches it", async () => {
    stub = startCompanionStub();
    const source = new GitTokenSource({ url: `${stub.url}/v1/git/token?repo={repo}`, headers: HEADERS });
    expect(await source.getToken("acme/widgets")).toBe("ghs_stub_acme/widgets");
    expect(stub.lastRepo).toBe("acme/widgets"); // encoded in transit, decoded server-side
    await source.getToken("acme/widgets");
    expect(stub.mintCount).toBe(1); // second call served from cache until expiry margin
  });
});
