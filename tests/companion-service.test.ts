/**
 * The reference companion service against its own spec
 * (docs/companion-service-spec.md) — GitHub App token minting verified down
 * to the JWT signature (stub GitHub API + real RSA keypair), server-side
 * skill resolution, ETag revalidation, auth, and a full round-trip with
 * Garage's actual clients (GitTokenSource / RemoteTemplateRegistry) talking
 * to the real server.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { startCompanion, type CompanionHandle } from "../src/companion/server.ts";
import { GitTokenSource } from "../src/garage/git-tokens.ts";
import { RemoteTemplateRegistry } from "../src/garage/templates/remote.ts";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

/** Minimal GitHub API stub that verifies the app JWT on every call. */
function startGitHubStub() {
  const seen = { jwtPayloads: [] as Array<Record<string, unknown>>, mintBodies: [] as Array<Record<string, unknown>>, mints: 0 };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const auth = req.headers.get("authorization") ?? "";
      const jwt = auth.replace("Bearer ", "");
      const [h, p, s] = jwt.split(".");
      const ok =
        h && p && s
          ? createVerify("RSA-SHA256")
              .update(`${h}.${p}`)
              .verify(publicKey, Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"))
          : false;
      if (!ok) return Response.json({ message: "bad jwt" }, { status: 401 });
      seen.jwtPayloads.push(JSON.parse(Buffer.from(p!, "base64").toString()));

      const u = new URL(req.url);
      const inst = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/installation$/);
      if (inst) {
        return inst[1] === "acme"
          ? Response.json({ id: 42 })
          : Response.json({ message: "not installed" }, { status: 404 });
      }
      if (u.pathname === "/app/installations/42/access_tokens" && req.method === "POST") {
        seen.mints++;
        seen.mintBodies.push((await req.json()) as Record<string, unknown>);
        return Response.json({ token: `ghs_minted_${seen.mints}`, expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      return Response.json({ message: "no route" }, { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, seen, close: () => server.stop(true) };
}

let companion: CompanionHandle | undefined;
let gh: ReturnType<typeof startGitHubStub> | undefined;
afterEach(() => {
  companion?.stop();
  gh?.close();
  companion = undefined;
  gh = undefined;
});

function boot(opts: { withGithub?: boolean; key?: string; templatesDir?: string } = {}) {
  gh = opts.withGithub === false ? undefined : startGitHubStub();
  companion = startCompanion({
    hostname: "127.0.0.1",
    port: 0,
    templatesDir: opts.templatesDir ?? tmp("ctmpl-"),
    key: opts.key,
    github: gh ? { appId: "777", privateKey: PEM, apiUrl: gh.url } : undefined,
  });
  return `http://127.0.0.1:${companion.port}`;
}

describe("companion: git tokens", () => {
  it("mints a repo-scoped installation token with a valid RS256 app JWT", async () => {
    const url = boot();
    const res = await fetch(`${url}/v1/git/token?repo=acme%2Fwidgets`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expires_at: string };
    expect(body.token).toBe("ghs_minted_1");
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now());
    expect(gh!.seen.jwtPayloads[0]?.iss).toBe("777");
    expect(gh!.seen.mintBodies[0]).toEqual({ repositories: ["widgets"] }); // scoped DOWN
  });

  it("caches tokens until the expiry margin", async () => {
    const url = boot();
    await fetch(`${url}/v1/git/token?repo=acme%2Fwidgets`);
    await fetch(`${url}/v1/git/token?repo=acme%2Fwidgets`);
    expect(gh!.seen.mints).toBe(1);
  });

  it("404s with not_installed for an ungranted repo", async () => {
    const url = boot();
    const res = await fetch(`${url}/v1/git/token?repo=stranger%2Frepo`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_installed");
  });

  it("404s with not_configured when no app credentials are set", async () => {
    const url = boot({ withGithub: false });
    const res = await fetch(`${url}/v1/git/token`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_configured");
  });
});

describe("companion: template registry", () => {
  function seedTemplates(): string {
    const dir = tmp("ctmpl-");
    fs.mkdirSync(path.join(dir, "skills/runbook/refs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills/runbook/SKILL.md"), "---\nname: runbook\ndescription: d\n---\n\nbody");
    fs.writeFileSync(path.join(dir, "skills/runbook/refs/list.md"), "- item");
    fs.writeFileSync(
      path.join(dir, "svc.json"),
      JSON.stringify({ system_prompt: "hi", skills: [{ from: "skills/runbook" }] }),
    );
    return dir;
  }

  it("resolves library skills into the files form server-side", async () => {
    const url = boot({ templatesDir: seedTemplates() });
    const body = (await (await fetch(`${url}/v1/templates`)).json()) as { templates: any[] };
    const skill = body.templates[0].skills[0];
    expect(skill.name).toBe("runbook");
    expect(skill.files.map((f: any) => f.path).sort()).toEqual(["SKILL.md", "refs/list.md"]);
    expect("from" in skill).toBe(false); // never leaks the disk form
  });

  it("revalidates with ETag/304 and 404s unknown names", async () => {
    const url = boot({ templatesDir: seedTemplates() });
    const first = await fetch(`${url}/v1/templates`);
    const etag = first.headers.get("etag")!;
    expect((await fetch(`${url}/v1/templates`, { headers: { "if-none-match": etag } })).status).toBe(304);
    expect((await fetch(`${url}/v1/templates/nope`)).status).toBe(404);
  });

  it("requires the bearer key when configured", async () => {
    const url = boot({ key: "svc-key", templatesDir: seedTemplates() });
    expect((await fetch(`${url}/v1/templates`)).status).toBe(401);
    expect((await fetch(`${url}/v1/templates`, { headers: { authorization: "Bearer svc-key" } })).status).toBe(200);
  });
});

describe("companion ↔ Garage clients round-trip", () => {
  it("GitTokenSource and RemoteTemplateRegistry consume the real server", async () => {
    const dir = tmp("ctmpl-");
    fs.writeFileSync(path.join(dir, "rt.json"), JSON.stringify({ system_prompt: "round trip" }));
    const url = boot({ key: "svc-key", templatesDir: dir });
    const headers = { authorization: "Bearer svc-key" };

    const tokens = new GitTokenSource({ url: `${url}/v1/git/token?repo={repo}`, headers });
    expect(await tokens.getToken("acme/widgets")).toBe("ghs_minted_1");

    const registry = new RemoteTemplateRegistry({ url: `${url}/v1/templates`, headers });
    expect((await registry.get("rt"))?.system_prompt).toBe("round trip");
  });
});
