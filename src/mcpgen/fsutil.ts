import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Read a file, or null if it doesn't exist / can't be read. */
export function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Write `content` atomically (tmp + rename) only when it differs from what's
 * on disk. Returns true when a write happened. Deterministic codegen relies
 * on this: an unchanged regeneration touches nothing and reports no diff.
 */
export function writeIfChanged(path: string, content: string, mode = 0o644): boolean {
  if (readIfExists(path) === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
  return true;
}

/** Delete a file if present. Returns true when something was removed. */
export function removeIfExists(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
