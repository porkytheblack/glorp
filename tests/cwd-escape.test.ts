import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { bashTool } from "../src/agent/tools/bash.ts";
import { commandEscapesWorkspace } from "../src/agent/tools/fs-shared.ts";

let workspace: string;
let home: string;
const display: any = {};
const glove: any = {};

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-cwd-ws-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-cwd-home-"));
});

afterEach(() => {
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
});

describe("commandEscapesWorkspace — workspace-local commands pass", () => {
  test.each([
    "ls",
    "ls -la",
    "pwd",
    "git status",
    "git log --oneline -5",
    "bun test",
    "npm install some-package",
    "cat README.md",
    "cat ./README.md",
    "cat src/foo.ts",
    "mkdir tmp/scratch",
    "find . -name '*.ts'",
    "find . -name *.ts",
    "echo hello",
    "ls > out.txt",
    "echo 'hi' > ./out.txt",
    "grep -rn foo .",
    "tar -czf out.tar.gz src/",
    "git diff -- src/foo.ts",
  ])("'%s' is allowed", (cmd) => {
    expect(commandEscapesWorkspace(cmd, workspace, home)).toBeNull();
  });

  test("/dev/null and friends are allowlisted", () => {
    expect(commandEscapesWorkspace("cmd > /dev/null 2>&1", workspace, home)).toBeNull();
    expect(commandEscapesWorkspace("cmd < /dev/stdin", workspace, home)).toBeNull();
    expect(commandEscapesWorkspace("cmd > /dev/stderr", workspace, home)).toBeNull();
    expect(commandEscapesWorkspace("echo x > /dev/fd/2", workspace, home)).toBeNull();
  });

  test("cd to subdirectory of workspace is allowed", () => {
    expect(commandEscapesWorkspace("cd src && ls", workspace, home)).toBeNull();
    expect(commandEscapesWorkspace("cd ./src && bun test", workspace, home)).toBeNull();
    expect(commandEscapesWorkspace(`cd ${workspace}/src && ls`, workspace, home)).toBeNull();
  });

  test("URLs are not mistaken for paths", () => {
    expect(commandEscapesWorkspace("curl https://example.com/api", workspace, home)).toBeNull();
    expect(commandEscapesWorkspace("git clone git://github.com/x/y.git", workspace, home)).toBeNull();
    expect(commandEscapesWorkspace("wget http://example.com/foo.tar.gz", workspace, home)).toBeNull();
  });
});

describe("commandEscapesWorkspace — outside-workspace commands flagged", () => {
  test.each([
    ["cat /etc/passwd", /references path outside the workspace/],
    ["cat /etc/shadow", /references path outside the workspace/],
    ["cat ~/.ssh/id_rsa", /references path outside the workspace/],
    ["cat ~/.aws/credentials", /references path outside the workspace/],
    ["cp foo ~/Desktop/", /references path outside the workspace/],
    ["echo x > /tmp/leaked", /references path outside the workspace/],
    ["echo x > ~/.zshrc", /references path outside the workspace/],
    ["python /usr/local/bin/something.py", /references path outside the workspace/],
    ["ls $HOME/Documents", /references path outside the workspace/],
    ["ls ${HOME}/Documents", /references path outside the workspace/],
    ["mv foo /var/tmp/foo", /references path outside the workspace/],
    ["chmod 755 /usr/local/bin/x", /references path outside the workspace/],
    ["sh /Users/don/somewhere/else/install.sh", /references path outside the workspace/],
  ])("'%s' is flagged", (cmd, expected) => {
    const reason = commandEscapesWorkspace(cmd, workspace, home);
    expect(reason).toMatch(expected);
  });

  test("cd to absolute outside path is flagged", () => {
    expect(commandEscapesWorkspace("cd /tmp && rm -rf *", workspace, home)).toMatch(/cd.*outside the workspace/);
    expect(commandEscapesWorkspace("cd /etc", workspace, home)).toMatch(/cd.*outside the workspace/);
  });

  test("cd to home is flagged", () => {
    expect(commandEscapesWorkspace("cd ~", workspace, home)).toMatch(/leaves the workspace/);
    expect(commandEscapesWorkspace("cd ~/", workspace, home)).toMatch(/outside the workspace/);
    expect(commandEscapesWorkspace("cd ~/Documents", workspace, home)).toMatch(/outside the workspace/);
    expect(commandEscapesWorkspace("cd $HOME", workspace, home)).toMatch(/leaves the workspace/);
    expect(commandEscapesWorkspace("cd $HOME/code", workspace, home)).toMatch(/outside the workspace/);
  });

  test("cd ../ that escapes is flagged", () => {
    // workspace lives at /tmp/glorp-cwd-ws-XXXX. cd ../.. lands in /tmp,
    // which is above the workspace — should be flagged.
    expect(commandEscapesWorkspace("cd ../..", workspace, home)).toMatch(/cd.*outside the workspace/);
  });

  test("pushd to outside path is flagged", () => {
    expect(commandEscapesWorkspace("pushd /etc", workspace, home)).toMatch(/cd.*outside the workspace/);
  });

  test("absolute path embedded in a redirect", () => {
    expect(commandEscapesWorkspace("git diff > /tmp/diff.patch", workspace, home)).toMatch(/outside the workspace/);
  });
});

// =====================================================================
// End-to-end through bashTool — refused without a real display.
// =====================================================================
describe("bashTool — cwd-escape commands refused without consent", () => {
  test.each([
    "cat /etc/hostname",
    "cd /tmp && pwd",
    "cd ~/Documents",
    "echo x > ~/.zshrc",
    "cp src/foo.ts /tmp/leaked.ts",
  ])("refuses '%s' without a display", async (cmd) => {
    const tool = bashTool(workspace);
    const r = await tool.do({ command: cmd, description: "test" }, display, glove);
    expect(r.status).toBe("error");
    expect(r.message ?? "").toMatch(/declined/i);
  });

  test("allowlisted /dev/null still works (no prompt path triggered)", async () => {
    const tool = bashTool(workspace);
    const r = await tool.do(
      { command: "echo hello > /dev/null", description: "noop" },
      display,
      glove,
    );
    // Doesn't go through askDestructiveConfirm — runs cleanly.
    expect(r.status).toBe("success");
  });

  test("ordinary workspace commands still run", async () => {
    fs.writeFileSync(path.join(workspace, "hi.txt"), "hi");
    const tool = bashTool(workspace);
    const r = await tool.do({ command: "cat hi.txt", description: "read local" }, display, glove);
    expect(r.status).toBe("success");
    expect(r.data as string).toContain("hi");
  });
});
