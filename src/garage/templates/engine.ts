/**
 * Executes a v2 template into a target workspace. Sections run in a fixed order
 *   params validation → repos → env → steps → skills → system_prompt → mcp
 * so files land before the skills/prompt/MCP that may reference them. `env`
 * runs after repos so it appends to (never clobbers) the gh-auth bridge. Every
 * template-author string is interpolated (`{param:NAME}` / `{env:VAR}`) just
 * before use; substituted values may be secrets, so they are collected and
 * scrubbed out of any error message surfaced to the API caller — nothing
 * interpolated is ever logged.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TemplateError, type Template, type TemplateStep, type TemplateMcpProvider } from "./types.ts";
import type { GitTokenSource } from "../git-tokens.ts";
import { isWithin } from "./engine-shared.ts";
import { provisionRepos } from "./engine-repos.ts";
import { provisionEnv } from "./engine-env.ts";
import { provisionSkills, provisionSystemPrompt, provisionMcp } from "./engine-sections.ts";

export { gitAuthEnv } from "./engine-repos.ts";

/**
 * Everything a v2 provision needs beyond the workspace itself: the template
 * library dir (skill `from` sources resolve under it), the pull-model git
 * token source (repos with `auth: "github"`), and the MCP provisioning
 * callback (wired to mcpgen by the namespace registry).
 */
export interface ProvisionContext {
  templatesDir: string;
  gitTokens?: GitTokenSource | null;
  provisionMcp?: (workspace: string, input: TemplateMcpProvider) => Promise<void>;
}

/** A context with no library/token/mcp seams — enough for v1-only templates. */
function emptyContext(): ProvisionContext {
  return { templatesDir: "" };
}

const TOKEN = /\{(param|env):([^}]+)\}/g;

export function interpolate(
  input: string,
  params: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
  onSub?: (value: string) => void,
): string {
  return input.replace(TOKEN, (_m, kind: string, name: string) => {
    const value = kind === "param" ? params[name] : env[name];
    if (value === undefined) {
      throw new TemplateError(`Missing ${kind} '${name}' for template`);
    }
    onSub?.(value);
    return value;
  });
}

/** Run every section in order. Throws TemplateError on the first failure. */
export async function provision(
  template: Template,
  params: Record<string, string>,
  workspace: string,
  ctx: ProvisionContext = emptyContext(),
): Promise<void> {
  // Values substituted from {param:}/{env:} — scrubbed from any error text.
  const secrets = new Set<string>();
  const sub = (v: string) => { if (v) secrets.add(v); };
  const interp = (input: string) => interpolate(input, params, process.env, sub);
  const scrub = (text: string) => redact(text, secrets);
  const spawn = (cmd: string[], cwd: string, label: string, env?: Record<string, string>) =>
    spawnRedacted(cmd, cwd, label, secrets, env);

  // Validate first so a missing required param fails before anything is written.
  validateParams(template, params, secrets);

  await provisionRepos(template, workspace, ctx, interp, secrets, spawn);
  provisionEnv(template, workspace, interp);
  await runSteps(template.steps ?? [], params, workspace, secrets);
  provisionSkills(template, workspace, ctx, interp);
  provisionSystemPrompt(template, workspace, interp);
  await provisionMcp(template, workspace, ctx, interp, scrub);
}

/**
 * Apply declared defaults into the effective params map, seed secret-declared
 * values for redaction, and reject when any required param has no value. All
 * missing required params are reported in ONE error, naming each.
 */
function validateParams(template: Template, params: Record<string, string>, secrets: Set<string>): void {
  const missing: string[] = [];
  for (const decl of template.params ?? []) {
    if (params[decl.name] === undefined && decl.default !== undefined) {
      params[decl.name] = decl.default;
    }
    if (decl.required && params[decl.name] === undefined) missing.push(decl.name);
    // A secret param's value is scrubbed from every error, even before its first use.
    if (decl.secret && params[decl.name]) secrets.add(params[decl.name]!);
  }
  if (missing.length > 0) {
    throw new TemplateError(`Missing required template param(s): ${missing.join(", ")}`);
  }
}

async function runSteps(
  steps: TemplateStep[],
  params: Record<string, string>,
  workspace: string,
  secrets: Set<string>,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    try {
      await runStep(step, params, workspace, secrets);
    } catch (err) {
      const raw = err instanceof TemplateError ? err.message : `step ${i + 1} (${step.type}) failed`;
      throw new TemplateError(redact(raw, secrets));
    }
  }
}

async function runStep(
  step: TemplateStep,
  params: Record<string, string>,
  workspace: string,
  secrets: Set<string>,
): Promise<void> {
  const sub = (v: string) => { if (v) secrets.add(v); };
  switch (step.type) {
    case "git-clone": {
      const repo = interpolate(step.repo, params, process.env, sub);
      const dest = step.dest ? interpolate(step.dest, params, process.env, sub) : ".";
      const args = ["git", "clone"];
      if (step.ref) args.push("--branch", interpolate(step.ref, params, process.env, sub));
      args.push(repo, dest);
      await spawnRedacted(args, workspace, "git-clone", secrets);
      return;
    }
    case "shell": {
      const command = interpolate(step.command, params, process.env, sub);
      await spawnRedacted(["sh", "-c", command], workspace, "shell", secrets);
      return;
    }
    case "copy": {
      const from = interpolate(step.from, params, process.env, sub);
      const to = path.resolve(workspace, interpolate(step.to, params, process.env, sub));
      if (!isWithin(workspace, to)) {
        throw new TemplateError("copy 'to' must stay within the workspace");
      }
      fs.cpSync(from, to, { recursive: true });
      return;
    }
  }
}

/**
 * Run a command, failing with a redacted TemplateError on a non-zero exit. The
 * optional `env` is layered onto the inherited process env (used to inject git
 * auth without it landing in argv); its values are added to the secrets set by
 * the caller so they never appear in the surfaced stderr.
 */
async function spawnRedacted(
  cmd: string[],
  cwd: string,
  label: string,
  secrets: Set<string>,
  env?: Record<string, string>,
): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : undefined,
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = (await new Response(proc.stderr).text()).slice(0, 500);
    throw new TemplateError(`${label} exited ${code}: ${redact(stderr.trim(), secrets)}`);
  }
}

/** Replace any interpolated secret value with *** so it never leaves the host. */
function redact(text: string, secrets: Set<string>): string {
  let out = text;
  for (const s of secrets) {
    if (s) out = out.split(s).join("***");
  }
  return out;
}
