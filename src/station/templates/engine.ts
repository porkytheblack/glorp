/**
 * Executes a template's steps sequentially in a target workspace. Step values
 * are interpolated with `{param:NAME}` and `{env:VAR}` just before execution;
 * interpolated values (which may contain secrets) are never logged and are
 * scrubbed out of any error message surfaced to the API caller.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TemplateError, type Template, type TemplateStep } from "./types.ts";

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

/** Run every step in order. Throws TemplateError on the first failure. */
export async function provision(
  template: Template,
  params: Record<string, string>,
  workspace: string,
): Promise<void> {
  // Values substituted from {param:}/{env:} — scrubbed from any error text.
  const secrets = new Set<string>();
  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i]!;
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
      await spawn(args, workspace, "git-clone", secrets);
      return;
    }
    case "shell": {
      const command = interpolate(step.command, params, process.env, sub);
      await spawn(["sh", "-c", command], workspace, "shell", secrets);
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

async function spawn(cmd: string[], cwd: string, label: string, secrets: Set<string>): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
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

/** True if `target` is the workspace itself or a path nested inside it. */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
