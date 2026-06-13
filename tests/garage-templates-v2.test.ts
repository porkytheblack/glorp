/**
 * Template engine v2: params validation, repos (local-fixture clone + auth env),
 * skills (inline + library), system_prompt → GLORP(.override).md, the MCP
 * section, plus the route/manager integration (provision, cleanup semantics) and
 * the TemplateSummaryDto wire shape. No network: repos clone a local git fixture.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { provision, gitAuthEnv } from "../src/garage/templates/engine.ts";
import { TemplateStore } from "../src/garage/templates/store.ts";
import { SessionManager } from "../src/garage/manager.ts";
import { startGarage } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";
import type { ProvisionContext } from "../src/garage/templates/engine.ts";
import type { Template, TemplateMcpProvider } from "../src/garage/templates/types.ts";

const tmpDirs: string[] = [];
function tmp(prefix = "tmpl-v2-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A bare-repo-free local git fixture clones can pull from via a file path. */
function gitFixture(file = "hello.txt", content = "hi from fixture"): string {
  const repo = tmp("fixture-repo-");
  const run = (args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { cwd: repo });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  };
  run(["init", "-q"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(repo, file), content);
  run(["add", "."]);
  run(["commit", "-q", "-m", "init"]);
  return repo;
}

const ctx = (over: Partial<ProvisionContext> = {}): ProvisionContext => ({ templatesDir: tmp("tmpldir-"), ...over });

describe("Template v2 — params validation", () => {
  it("reports all missing required params in one error", async () => {
    const ws = tmp("ws-");
    const t: Template = { name: "t", system_prompt: "x", params: [{ name: "a", required: true }, { name: "b", required: true }] };
    await expect(provision(t, {}, ws, ctx())).rejects.toThrow(/Missing required template param\(s\): a, b/);
  });

  it("applies declared defaults so they satisfy a system_prompt", async () => {
    const ws = tmp("ws-");
    const t: Template = { name: "t", system_prompt: "Hello {param:who}", params: [{ name: "who", default: "world" }] };
    await provision(t, {}, ws, ctx());
    expect(fs.readFileSync(path.join(ws, "GLORP.md"), "utf-8")).toBe("Hello world");
  });

  it("scrubs a secret-declared param value out of error text", async () => {
    const ws = tmp("ws-");
    const t: Template = {
      name: "t",
      params: [{ name: "tok", secret: true }],
      steps: [{ type: "shell", command: "echo {param:tok} >&2; exit 1" }],
    };
    let msg = "";
    try {
      await provision(t, { tok: "TOP-SECRET-VALUE" }, ws, ctx());
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).not.toContain("TOP-SECRET-VALUE");
    expect(msg).toContain("***");
  });
});

describe("Template v2 — skills", () => {
  it("installs an inline skill and synthesizes front-matter when absent", async () => {
    const ws = tmp("ws-");
    const t: Template = {
      name: "t",
      skills: [{ name: "deploy", description: "Ship it", content: "Run the deploy checklist." }],
    };
    await provision(t, {}, ws, ctx());
    const md = fs.readFileSync(path.join(ws, ".claude/skills/deploy/SKILL.md"), "utf-8");
    expect(md).toBe("---\nname: deploy\ndescription: Ship it\n---\n\nRun the deploy checklist.");
  });

  it("keeps author-provided front-matter and interpolates inline content", async () => {
    const ws = tmp("ws-");
    const t: Template = {
      name: "t",
      params: [{ name: "team" }],
      skills: [{ name: "k", content: "---\nname: k\ndescription: d\n---\n\nFor {param:team}." }],
    };
    await provision(t, { team: "Platform" }, ws, ctx());
    const md = fs.readFileSync(path.join(ws, ".claude/skills/k/SKILL.md"), "utf-8");
    expect(md).toContain("For Platform.");
    expect(md.startsWith("---\nname: k")).toBe(true);
  });

  it("copies a library `from` skill and refuses one without SKILL.md", async () => {
    const ws = tmp("ws-");
    const templatesDir = tmp("tmpldir-");
    const src = path.join(templatesDir, "lib-skill");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "SKILL.md"), "---\nname: lib\ndescription: lib skill\n---\n\nbody");
    fs.writeFileSync(path.join(src, "ref.md"), "reference");

    await provision({ name: "t", skills: [{ from: "lib-skill", name: "installed" }] }, {}, ws, ctx({ templatesDir }));
    expect(fs.readFileSync(path.join(ws, ".claude/skills/installed/SKILL.md"), "utf-8")).toContain("lib skill");
    expect(fs.existsSync(path.join(ws, ".claude/skills/installed/ref.md"))).toBe(true);

    const ws2 = tmp("ws-");
    await expect(
      provision({ name: "t", skills: [{ from: "missing" }] }, {}, ws2, ctx({ templatesDir })),
    ).rejects.toThrow(/has no SKILL\.md/);
  });

  it("refuses a `from` skill that escapes the templates directory", async () => {
    const ws = tmp("ws-");
    const templatesDir = tmp("tmpldir-");
    await expect(
      provision({ name: "t", skills: [{ from: "../escape" }] }, {}, ws, ctx({ templatesDir })),
    ).rejects.toThrow(/escapes the templates directory/);
  });
});

describe("Template v2 — system_prompt", () => {
  it("writes GLORP.md normally", async () => {
    const ws = tmp("ws-");
    await provision({ name: "t", system_prompt: "Be terse." }, {}, ws, ctx());
    expect(fs.readFileSync(path.join(ws, "GLORP.md"), "utf-8")).toBe("Be terse.");
    expect(fs.existsSync(path.join(ws, "GLORP.override.md"))).toBe(false);
  });

  it("falls back to GLORP.override.md when a repo already shipped GLORP.md", async () => {
    const ws = tmp("ws-");
    fs.writeFileSync(path.join(ws, "GLORP.md"), "REPO PROMPT");
    await provision({ name: "t", system_prompt: "TEMPLATE PROMPT" }, {}, ws, ctx());
    expect(fs.readFileSync(path.join(ws, "GLORP.md"), "utf-8")).toBe("REPO PROMPT");
    expect(fs.readFileSync(path.join(ws, "GLORP.override.md"), "utf-8")).toBe("TEMPLATE PROMPT");
  });
});

describe("Template v2 — repos", () => {
  it("clones a local fixture repo to its default basename", async () => {
    const ws = tmp("ws-");
    const fixture = gitFixture();
    await provision({ name: "t", repos: [{ url: fixture }] }, {}, ws, ctx());
    const dest = path.join(ws, path.basename(fixture));
    expect(fs.existsSync(path.join(dest, "hello.txt"))).toBe(true);
  });

  it("clones into a declared dest", async () => {
    const ws = tmp("ws-");
    const fixture = gitFixture();
    await provision({ name: "t", repos: [{ url: fixture, dest: "vendor/lib" }] }, {}, ws, ctx());
    expect(fs.existsSync(path.join(ws, "vendor/lib/hello.txt"))).toBe(true);
  });

  it("rejects a dest that escapes the workspace", async () => {
    const ws = tmp("ws-");
    const fixture = gitFixture();
    await expect(
      provision({ name: "t", repos: [{ url: fixture, dest: "../escape" }] }, {}, ws, ctx()),
    ).rejects.toThrow(/must stay within the workspace/);
  });

  it("errors clearly when auth:github is requested but no token service is configured", async () => {
    const ws = tmp("ws-");
    await expect(
      provision({ name: "t", repos: [{ url: "https://github.com/acme/app.git", auth: "github" }] }, {}, ws, ctx({ gitTokens: null })),
    ).rejects.toThrow(/needs auth but no git token service is configured \(set gitTokenUrl\)/);
  });

  it("installs the glorp __git-cred helper into an authed clone", async () => {
    const ws = tmp("ws-");
    const fixture = gitFixture();
    // A fake token source: a file:// clone ignores the injected http.extraHeader,
    // so this exercises the auth env + cred-helper install without any network.
    const gitTokens = { getToken: async () => "ghs_FAKE_TOKEN" } as unknown as NonNullable<ProvisionContext["gitTokens"]>;
    await provision({ name: "t", repos: [{ url: fixture, dest: "repo", auth: "github" }] }, {}, ws, ctx({ gitTokens }));
    const gitConfig = fs.readFileSync(path.join(ws, "repo", ".git", "config"), "utf-8");
    expect(gitConfig).toContain("__git-cred");
    // useHttpPath makes git pass the repo path to the helper — without it the
    // helper can't scope tokens and strict token services refuse the mint.
    expect(gitConfig.replace(/\s/g, "")).toContain("useHttpPath=true");
    // The token never lands in .git/config (it rides http.extraHeader env only).
    expect(gitConfig).not.toContain("ghs_FAKE_TOKEN");
    // A gh-auth bridge is written so `gh` works without the agent acquiring a
    // token — it mints via the repo's credential helper and exports GH_TOKEN.
    const ghEnv = fs.readFileSync(path.join(ws, ".glorp", "gh-env.sh"), "utf-8");
    expect(ghEnv).toContain("export GH_TOKEN");
    expect(ghEnv).toContain("credential fill");
    expect(ghEnv).toContain(path.join(ws, "repo")); // mints against the cloned repo
    expect(ghEnv).not.toContain("ghs_FAKE_TOKEN"); // no token baked into the script
  });

  it("writes the gh-auth bridge for the FIRST authed repo (deterministic, not last-wins)", async () => {
    const ws = tmp("ws-");
    const a = gitFixture("a.txt", "a");
    const b = gitFixture("b.txt", "b");
    const gitTokens = { getToken: async () => "ghs_FAKE_TOKEN" } as unknown as NonNullable<ProvisionContext["gitTokens"]>;
    await provision(
      { name: "t", repos: [{ url: a, dest: "primary", auth: "github" }, { url: b, dest: "secondary", auth: "github" }] },
      {}, ws, ctx({ gitTokens }),
    );
    const ghEnv = fs.readFileSync(path.join(ws, ".glorp", "gh-env.sh"), "utf-8");
    expect(ghEnv).toContain(path.join(ws, "primary"));
    expect(ghEnv).not.toContain(path.join(ws, "secondary")); // first wins, deterministically
  });
});

describe("Template v2 — gitAuthEnv (pure)", () => {
  it("injects http.extraHeader via env config, never argv/.git/config", () => {
    const env = gitAuthEnv("ghs_TOKEN123");
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    const expected = Buffer.from("x-access-token:ghs_TOKEN123").toString("base64");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${expected}`);
  });
});

describe("Template v2 — mcp", () => {
  it("passes interpolated url + identity header values to the provisioner", async () => {
    const ws = tmp("ws-");
    const seen: Array<{ workspace: string; input: TemplateMcpProvider }> = [];
    const provisionMcp = async (workspace: string, input: TemplateMcpProvider) => {
      seen.push({ workspace, input });
    };
    const t: Template = {
      name: "t",
      params: [{ name: "host" }, { name: "token", secret: true }],
      mcp: [
        {
          provider: "linear",
          url: "https://{param:host}/mcp",
          defaultIdentity: "acme",
          identities: [{ name: "acme", headers: { authorization: "Bearer {param:token}" } }],
        },
      ],
    };
    await provision(t, { host: "mcp.example.com", token: "SECRET_TOK" }, ws, ctx({ provisionMcp }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.workspace).toBe(ws);
    expect(seen[0]!.input.url).toBe("https://mcp.example.com/mcp");
    expect(seen[0]!.input.identities?.[0]?.headers?.authorization).toBe("Bearer SECRET_TOK");
  });

  it("errors when an mcp section is declared but no provisioner is configured", async () => {
    const ws = tmp("ws-");
    await expect(
      provision({ name: "t", mcp: [{ provider: "linear", url: "https://x/mcp" }] }, {}, ws, ctx()),
    ).rejects.toThrow(/no MCP provisioner is configured/);
  });

  it("wraps + redacts a provider failure with its name", async () => {
    const ws = tmp("ws-");
    const provisionMcp = async () => {
      throw new Error("boom with SECRET_TOK inside");
    };
    let msg = "";
    try {
      await provision(
        {
          name: "t",
          params: [{ name: "token", secret: true }],
          mcp: [{ provider: "linear", url: "https://x/mcp", identities: [{ name: "a", headers: { authorization: "{param:token}" } }] }],
        },
        { token: "SECRET_TOK" },
        ws,
        ctx({ provisionMcp }),
      );
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain("mcp provider 'linear'");
    expect(msg).not.toContain("SECRET_TOK");
    expect(msg).toContain("***");
  });
});

describe("Template v2 — ordering", () => {
  it("runs repos before steps before system_prompt (a step sees the clone)", async () => {
    const ws = tmp("ws-");
    const fixture = gitFixture("marker.txt", "present");
    const t: Template = {
      name: "t",
      repos: [{ url: fixture, dest: "repo" }],
      steps: [{ type: "shell", command: "test -f repo/marker.txt && echo ok > step-ran.txt" }],
      system_prompt: "after steps",
    };
    await provision(t, {}, ws, ctx());
    expect(fs.readFileSync(path.join(ws, "step-ran.txt"), "utf-8").trim()).toBe("ok");
    expect(fs.existsSync(path.join(ws, "GLORP.md"))).toBe(true);
  });
});

describe("Template v2 — manager integration", () => {
  function mgrWith(templatesDir: string, dataDir: string): SessionManager {
    const templates = new TemplateStore(templatesDir);
    return new SessionManager({
      dataDir,
      workspaceRoot: path.join(dataDir, "ws"),
      permissionMode: "normal",
      templates: {
        has: (n) => templates.has(n),
        provision: (n, p, w) => provision(templates.get(n)!, p, w, { templatesDir }),
      },
    });
  }

  it("deletes a minted workspace on template failure", async () => {
    const dataDir = tmp("data-");
    const templatesDir = tmp("tmpldir-");
    fs.writeFileSync(path.join(templatesDir, "bad.json"), JSON.stringify({ steps: [{ type: "shell", command: "exit 7" }] }));
    const m = mgrWith(templatesDir, dataDir);
    await expect(m.createWorkspace({ name: "doomed", template: "bad" })).rejects.toThrow(/provisioning failed/);
    // No leftover minted folder under the workspace root.
    const root = path.join(dataDir, "ws");
    const leftovers = fs.existsSync(root) ? fs.readdirSync(root) : [];
    expect(leftovers).toHaveLength(0);
  });

  it("keeps an adopted, pre-existing path on template failure", async () => {
    const dataDir = tmp("data-");
    const templatesDir = tmp("tmpldir-");
    const adopted = tmp("adopted-");
    fs.writeFileSync(path.join(adopted, "keep.txt"), "user file");
    fs.writeFileSync(path.join(templatesDir, "bad.json"), JSON.stringify({ steps: [{ type: "shell", command: "exit 7" }] }));
    const m = mgrWith(templatesDir, dataDir);
    await expect(m.createWorkspace({ path: adopted, template: "bad" })).rejects.toThrow(/provisioning failed/);
    expect(fs.existsSync(path.join(adopted, "keep.txt"))).toBe(true);
  });

  it("provisions a workspace from a v2 template (skill + prompt)", async () => {
    const dataDir = tmp("data-");
    const templatesDir = tmp("tmpldir-");
    fs.writeFileSync(
      path.join(templatesDir, "v2.json"),
      JSON.stringify({
        system_prompt: "You are a helper.",
        skills: [{ name: "greet", description: "Greet", content: "Say hi." }],
      }),
    );
    const m = mgrWith(templatesDir, dataDir);
    const ws = await m.createWorkspace({ name: "v2ws", template: "v2" });
    expect(fs.readFileSync(path.join(ws.path, "GLORP.md"), "utf-8")).toBe("You are a helper.");
    expect(fs.existsSync(path.join(ws.path, ".claude/skills/greet/SKILL.md"))).toBe(true);
  });
});

describe("Template v2 — GET /templates wire shape", () => {
  it("returns the full TemplateSummaryDto with counts + null-normalized params", async () => {
    const dataDir = tmp("data-");
    const templatesDir = path.join(dataDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(templatesDir, "rich.json"),
      JSON.stringify({
        description: "Rich template",
        steps: [{ type: "shell", command: "true" }],
        repos: [{ url: "https://github.com/acme/app" }],
        skills: [{ name: "s", content: "body" }],
        system_prompt: "prompt",
        mcp: [{ provider: "linear", url: "https://x/mcp" }],
        params: [{ name: "tok", secret: true, required: true }],
      }),
    );
    // templatesDir defaults to <dataDir>/templates (see config.ts), which is
    // exactly where we wrote rich.json above.
    const config = loadGarageConfig({ dataDir, port: 0, hostname: "127.0.0.1" });
    const garage = await startGarage(config);
    try {
      const res = await fetch(`http://127.0.0.1:${garage.port}/api/v1/templates`);
      const body = (await res.json()) as { templates: Array<Record<string, unknown>> };
      const rich = body.templates.find((t) => t.name === "rich")!;
      expect(rich).toMatchObject({
        name: "rich",
        description: "Rich template",
        step_count: 1,
        repo_count: 1,
        skill_count: 1,
        mcp_count: 1,
        has_system_prompt: true,
      });
      expect(rich.params).toEqual([
        { name: "tok", description: null, required: true, default: null, secret: true },
      ]);
    } finally {
      await garage.stop();
    }
  });
});

describe("gitCredHelperCommand", () => {
  it("source mode: hands bun the CLI script before the subcommand", () => {
    const { gitCredHelperCommand } = require("../src/garage/templates/engine-repos.ts");
    const script = path.resolve("src/cli.ts"); // a real file on disk
    expect(gitCredHelperCommand("/usr/local/bin/bun", script)).toBe(`!"/usr/local/bin/bun" "${script}" __git-cred`);
  });

  it("compiled mode: virtual /$bunfs argv[1] is not a real file — execPath dispatches itself", () => {
    const { gitCredHelperCommand } = require("../src/garage/templates/engine-repos.ts");
    expect(gitCredHelperCommand("/usr/local/bin/glorp", "/$bunfs/root/cli.js")).toBe('!"/usr/local/bin/glorp" __git-cred');
  });
});
