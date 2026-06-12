/**
 * Repo-cloning section of the v2 template engine. Clones every declared repo
 * into the workspace; auth-tagged repos route through the pull-model git token
 * service and install the `glorp __git-cred` credential helper so fetch/push
 * keep working after the provision-time token expires — without any token ever
 * touching argv (process listings) or `.git/config` (on-disk).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TemplateError, type Template, type TemplateRepo } from "./types.ts";
import { isWithin, type Interpolator, type SectionSpawn } from "./engine-shared.ts";
import type { ProvisionContext } from "./engine.ts";

/**
 * The env that injects a GitHub installation token into `git clone` WITHOUT it
 * touching argv or `.git/config`. Git reads `GIT_CONFIG_COUNT` ad-hoc config
 * from the environment, so this sets one `http.extraHeader` carrying HTTP Basic
 * `x-access-token:<token>` — the scheme GitHub App tokens use. Exported pure for
 * direct unit testing.
 */
export function gitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

/** Parse `owner/name` out of a GitHub-style clone URL (drops a trailing `.git`). */
export function repoSlug(url: string): string | null {
  // Accept https://host/owner/name(.git) and scp-like git@host:owner/name(.git).
  const m = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Default a repo's destination to its basename (sans `.git`). */
function defaultDest(url: string): string {
  const tail = url.replace(/\/+$/, "").split("/").pop() ?? "repo";
  return tail.replace(/\.git$/, "") || "repo";
}

export async function provisionRepos(
  template: Template,
  workspace: string,
  ctx: ProvisionContext,
  interp: Interpolator,
  secrets: Set<string>,
  spawn: SectionSpawn,
): Promise<void> {
  for (const repo of template.repos ?? []) {
    await cloneRepo(repo, workspace, ctx, interp, secrets, spawn);
  }
}

async function cloneRepo(
  repo: TemplateRepo,
  workspace: string,
  ctx: ProvisionContext,
  interp: Interpolator,
  secrets: Set<string>,
  spawn: SectionSpawn,
): Promise<void> {
  const url = interp(repo.url);
  const dest = repo.dest ? interp(repo.dest) : defaultDest(url);
  const target = path.resolve(workspace, dest);
  if (!isWithin(workspace, target)) {
    throw new TemplateError(`repo dest '${dest}' must stay within the workspace`);
  }
  const ref = repo.ref ? interp(repo.ref) : undefined;
  const env = repo.auth === "github" ? await githubAuthEnv(url, ctx, secrets) : undefined;
  const args = ["git", "clone", ...(ref ? ["--branch", ref] : []), url, dest];
  await spawn(args, workspace, `clone ${url}`, env);
  if (env) await installCredHelper(target, spawn);
}

/** Resolve a GitHub token for `url` and turn it into the clone-time auth env. */
async function githubAuthEnv(url: string, ctx: ProvisionContext, secrets: Set<string>): Promise<Record<string, string>> {
  if (!ctx.gitTokens) {
    throw new TemplateError(`repo ${url} needs auth but no git token service is configured (set gitTokenUrl)`);
  }
  const slug = repoSlug(url);
  if (!slug) throw new TemplateError(`repo ${url} needs auth but its owner/name could not be parsed from the URL`);
  const token = await ctx.gitTokens.getToken(slug);
  if (!token) throw new TemplateError(`git token service returned no token for ${slug}`);
  const env = gitAuthEnv(token);
  // Both the raw token and the header carrying it must never surface in errors.
  secrets.add(token);
  secrets.add(env.GIT_CONFIG_VALUE_0);
  return env;
}

/**
 * Install the `glorp __git-cred` credential helper inside a freshly-cloned repo.
 * Set via argv (no shell) so the `!`-prefixed shell-out and the absolute helper
 * path are never re-quoted by an intermediate shell.
 */
async function installCredHelper(repoDir: string, spawn: SectionSpawn): Promise<void> {
  await spawn(["git", "config", "credential.helper", gitCredHelperCommand()], repoDir, "configure credential helper");
  // Git hands `path` to credential helpers ONLY with useHttpPath — and the
  // helper scopes its token request to that owner/repo. Without it every
  // post-clone fetch/push asks the token service for an unscoped token,
  // which strict services (no default owner) refuse.
  await spawn(["git", "config", "credential.useHttpPath", "true"], repoDir, "configure credential path scoping");
}

/**
 * The credential-helper invocation, correct for BOTH runtimes. In the compiled
 * binary, execPath IS glorp and dispatches `__git-cred` itself. Running from
 * source (`bun src/cli.ts garage` — dev hosts, the Docker source mode),
 * execPath is bun, which must be handed the CLI script first or it would try
 * to execute a file literally named `__git-cred`. Source mode is detected the
 * same way the orchestrator runner does it: the script path exists as a real
 * file on disk — a compiled binary's argv[1] is a virtual /$bunfs path that
 * stat() rejects. Paths are quoted because git runs `!`-helpers through sh.
 */
export function gitCredHelperCommand(
  execPath = process.execPath,
  script: string | undefined = process.argv[1],
): string {
  const fromSource = (() => {
    try {
      return script !== undefined && fs.statSync(script).isFile();
    } catch {
      return false;
    }
  })();
  return fromSource ? `!"${execPath}" "${script}" __git-cred` : `!"${execPath}" __git-cred`;
}
