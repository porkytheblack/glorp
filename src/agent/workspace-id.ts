import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * Derive a stable project id for a workspace.
 *
 * Prefers the workspace's git-repository root-commit hash so that worktrees,
 * clones, and the same repo on different machines all resolve to the same
 * project id (the trick opencode uses — issue #1877 closed wontfix on their
 * side; we want the friendlier behaviour). Falls back to a SHA-256 of the
 * absolute workspace path for non-git directories.
 *
 * Return value is always 16 hex chars — short enough to use as a filesystem
 * fragment, long enough to avoid collisions for any plausible session count.
 */
export function deriveProjectId(workspace: string): string {
  const abs = path.resolve(workspace);
  const rootCommit = tryGitRootCommit(abs);
  const seed = rootCommit ? `git:${rootCommit}` : `path:${abs}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

function tryGitRootCommit(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 1_500,
    });
    // A repo can technically have multiple root commits (rare — usually from
    // merges of unrelated histories). Take the first one for stability.
    const first = out.split("\n").map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}
