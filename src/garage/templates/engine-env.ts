/**
 * Environment section of the v2 template engine. Turns a template's declared
 * `env` map into `export NAME=value` lines appended to the per-workspace
 * `.glorp/gh-env.sh` script — the file `BASH_ENV` points at (set in the session
 * env, see agent/glorp.ts), so bash sources it before EVERY command and the
 * agent reads the values as ordinary environment variables.
 *
 * Runs after repo cloning, so it coexists with the GitHub-auth bridge that the
 * repos section writes into the same file (append, never clobber). Values are
 * interpolated through the shared secrets-collecting seam, so any `{param:}` /
 * `{env:}` substitution is scrubbed from surfaced errors; values are
 * shell-quoted so spaces/quotes/`$` are written literally, never expanded.
 *
 * Cleanly isolated: the script lives in this task's own workspace and nowhere
 * else, so one task's env can never leak into another's.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TemplateError, type Template } from "./types.ts";
import { shq, type Interpolator } from "./engine-shared.ts";

/** POSIX environment-variable name: a letter/underscore, then word chars. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function provisionEnv(template: Template, workspace: string, interp: Interpolator): void {
  const entries = Object.entries(template.env ?? {});
  if (entries.length === 0) return;

  const lines: string[] = [];
  for (const [name, rawValue] of entries) {
    if (!ENV_NAME.test(name)) {
      throw new TemplateError(`env var name '${name}' is not a valid shell identifier`);
    }
    lines.push(`export ${name}=${shq(interp(rawValue))}`);
  }

  const dir = path.join(workspace, ".glorp");
  fs.mkdirSync(dir, { recursive: true });
  // Append (don't clobber): the repos section may already have written the
  // gh-auth bridge into this same BASH_ENV-sourced file.
  const block = ["", "# Template-declared environment (Glorp)", ...lines, ""].join("\n");
  fs.appendFileSync(path.join(dir, "gh-env.sh"), block);
}
