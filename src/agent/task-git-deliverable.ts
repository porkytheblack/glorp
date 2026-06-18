/**
 * Git deliverable enforcement. For repo tasks (e.g. git-service) the deliverable
 * is a PUSHED feature branch with an open pull request — not files. The sandbox
 * is ephemeral, so a task that edits files but never commits/pushes/opens a PR
 * produces nothing usable. This probes git/gh state in the cloned repo at
 * deliver_result time and returns violations, so the task sink REJECTS the
 * delivery (and the task can't read "completed") until the work is proposed —
 * mirroring the file-based deliverable contract in task-deliverable.ts.
 */

import type { DeliverableViolation, GitDeliverable } from "./task-deliverable.ts";

/** Runs the probe and returns its single status token (see PROBE). Injectable for tests. */
export interface GitProbeRunner {
  (opts: { workspace: string; repoDir: string; ghEnvFile: string }): Promise<string>;
}

const NUDGE = "Your deliverable is a pull request, not files — this sandbox is discarded, so ";

/**
 * Map a probe status token to violations. Pure (unit-tested). Tokens:
 *  OK <url> / OK_NO_GH <b> ⇒ satisfied · NO_PR <b> · NOT_REPO · ON_DEFAULT <b> ·
 *  NO_UPSTREAM <b>. An unknown/empty token never blocks (never lose correct work).
 */
export function gitDeliverableViolations(token: string, requirePr: boolean): DeliverableViolation[] {
  const [tag, ...rest] = token.trim().split(/\s+/);
  const b = rest.join(" ") || "your branch";
  switch (tag) {
    case "OK":
    case "OK_NO_GH":
      return [];
    case "NO_PR":
      return requirePr
        ? [{ code: "git_no_pr", message: `${NUDGE}branch '${b}' is pushed but has no open PR. Open one with \`gh pr create\` and deliver again.` }]
        : [];
    case "NOT_REPO":
      return [{ code: "git_not_repo", message: `${NUDGE}no git repository was found to deliver from (expected the cloned repo).` }];
    case "ON_DEFAULT":
      return [{ code: "git_on_default", message: `${NUDGE}you are on the default branch ('${b}'). Create a feature branch (\`git switch -c …\`), commit, push, and open a PR.` }];
    case "NO_UPSTREAM":
      return [{ code: "git_not_pushed", message: `${NUDGE}branch '${b}' has no commits pushed to origin. Run \`git push -u origin ${b}\` and open a PR.` }];
    default:
      return [];
  }
}

// Sourced gh-env bridge (mints a fresh GH_TOKEN), then: confirm a repo, reject
// the default branch, require an upstream (pushed), and confirm an open PR for
// the branch. gh absent ⇒ OK_NO_GH (a pushed branch is never lost on a host that
// can't reach gh). Single status line on stdout; exit code is ignored.
const PROBE = [
  '[ -f "$GH_ENV" ] && . "$GH_ENV" >/dev/null 2>&1 || true',
  'cd "$REPO" 2>/dev/null || { echo NOT_REPO; exit 0; }',
  'git rev-parse --git-dir >/dev/null 2>&1 || { echo NOT_REPO; exit 0; }',
  'b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)',
  'case "$b" in main|master|HEAD|"") echo "ON_DEFAULT $b"; exit 0;; esac',
  "git rev-parse --symbolic-full-name '@{u}' >/dev/null 2>&1 || { echo \"NO_UPSTREAM $b\"; exit 0; }",
  'command -v gh >/dev/null 2>&1 || { echo "OK_NO_GH $b"; exit 0; }',
  'u=$(gh pr list --head "$b" --state open --json url -q ".[0].url" 2>/dev/null || true)',
  '[ -n "$u" ] && echo "OK $u" || echo "NO_PR $b"',
].join("\n");

const defaultRunner: GitProbeRunner = async ({ workspace, repoDir, ghEnvFile }) => {
  try {
    const proc = Bun.spawn(["bash", "-c", PROBE], {
      cwd: workspace,
      env: { ...process.env, REPO: repoDir, GH_ENV: ghEnvFile },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 20_000);
    await proc.exited;
    clearTimeout(timer);
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return ""; // can't probe (no bash) → unknown token → don't block
  }
};

/**
 * Validate a git deliverable against the repo's live state. `noChange` (the
 * agent's explicit "no code change was needed") satisfies the contract without
 * a PR. Returns [] when satisfied, else the violations the agent must fix.
 */
export async function validateGitDeliverable(opts: {
  workspace: string;
  gitRequired: GitDeliverable;
  noChange?: boolean;
  run?: GitProbeRunner;
}): Promise<DeliverableViolation[]> {
  if (opts.noChange) return [];
  const repoDir = opts.gitRequired.repoDir ?? "app";
  const ghEnvFile = `${opts.workspace}/.glorp/gh-env.sh`;
  const token = await (opts.run ?? defaultRunner)({ workspace: opts.workspace, repoDir, ghEnvFile });
  return gitDeliverableViolations(token, opts.gitRequired.requirePr !== false);
}
