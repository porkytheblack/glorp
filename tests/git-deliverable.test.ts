/**
 * Git deliverable enforcement (task-git-deliverable.ts) — the contract that a
 * repo task must end with a pushed branch + open PR. The probe (git/gh) is
 * injected so the mapping is exercised without a real repo.
 */

import { describe, it, expect } from "bun:test";
import {
  gitDeliverableViolations,
  validateGitDeliverable,
} from "../src/agent/task-git-deliverable.ts";

describe("gitDeliverableViolations", () => {
  it("accepts an open PR (and a pushed branch when gh is unavailable)", () => {
    expect(gitDeliverableViolations("OK https://github.com/a/b/pull/1", true)).toEqual([]);
    expect(gitDeliverableViolations("OK_NO_GH feat/x", true)).toEqual([]);
  });

  it("rejects a pushed branch with no PR only when a PR is required", () => {
    const required = gitDeliverableViolations("NO_PR feat/x", true);
    expect(required).toHaveLength(1);
    expect(required[0]!.code).toBe("git_no_pr");
    expect(gitDeliverableViolations("NO_PR feat/x", false)).toEqual([]);
  });

  it("rejects the default branch, an unpushed branch, and a non-repo", () => {
    expect(gitDeliverableViolations("ON_DEFAULT main", true)[0]!.code).toBe("git_on_default");
    expect(gitDeliverableViolations("NO_UPSTREAM feat/x", true)[0]!.code).toBe("git_not_pushed");
    expect(gitDeliverableViolations("NOT_REPO", true)[0]!.code).toBe("git_not_repo");
  });

  it("never blocks on an unknown or empty token", () => {
    expect(gitDeliverableViolations("", true)).toEqual([]);
    expect(gitDeliverableViolations("WAT something", true)).toEqual([]);
  });
});

describe("validateGitDeliverable", () => {
  const run = (token: string) => async () => token;

  it("short-circuits to satisfied when the agent declares no change", async () => {
    let called = false;
    const v = await validateGitDeliverable({
      workspace: "/ws",
      gitRequired: { requirePr: true },
      noChange: true,
      run: async () => { called = true; return "NO_PR feat/x"; },
    });
    expect(v).toEqual([]);
    expect(called).toBe(false);
  });

  it("requires a PR by default", async () => {
    const v = await validateGitDeliverable({
      workspace: "/ws",
      gitRequired: {},
      run: run("NO_PR feat/x"),
    });
    expect(v[0]!.code).toBe("git_no_pr");
  });

  it("honors requirePr:false (a pushed branch is enough)", async () => {
    const v = await validateGitDeliverable({
      workspace: "/ws",
      gitRequired: { requirePr: false },
      run: run("NO_PR feat/x"),
    });
    expect(v).toEqual([]);
  });

  it("passes the configured repoDir to the probe", async () => {
    let seen = "";
    await validateGitDeliverable({
      workspace: "/ws",
      gitRequired: { repoDir: "service", requirePr: true },
      run: async ({ repoDir }) => { seen = repoDir; return "OK url"; },
    });
    expect(seen).toBe("service");
  });
});
