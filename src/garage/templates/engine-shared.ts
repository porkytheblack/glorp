/**
 * Shared seams for the v2 template engine sections: the path-confinement check,
 * the interpolation function type (wired to the secrets collector by the
 * orchestrator), and the redacting-spawn signature passed to repo cloning.
 */

import * as path from "node:path";

/** Interpolate a template-author string; substituted values are collected as secrets. */
export type Interpolator = (input: string) => string;

/** Run a command (optionally with extra env), failing redacted on non-zero exit. */
export type SectionSpawn = (
  cmd: string[],
  cwd: string,
  label: string,
  env?: Record<string, string>,
) => Promise<void>;

/** True if `target` is the root itself or a path nested inside it. */
export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
