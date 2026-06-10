
describe("extension read roots (skills outside the workspace)", () => {
  const { resolveSafePath, extensionReadRoots } = require("../src/agent/tools/fs-shared.ts");
  const os = require("node:os");
  const path = require("node:path");

  test("read tools may follow registered skill roots", () => {
    const ws = "/tmp/some-workspace";
    const skill = path.join(os.homedir(), ".agents", "skills", "glove", "SKILL.md");
    expect(resolveSafePath(ws, skill, extensionReadRoots(ws))).toBe(skill);
  });

  test("everything else outside the workspace still refuses", () => {
    const ws = "/tmp/some-workspace";
    expect(() => resolveSafePath(ws, "/etc/passwd", extensionReadRoots(ws))).toThrow(/outside the workspace/);
    expect(() => resolveSafePath(ws, path.join(os.homedir(), ".ssh", "id_rsa"), extensionReadRoots(ws))).toThrow(/outside the workspace/);
  });

  test("write tools (no roots passed) keep the strict workspace boundary", () => {
    const ws = "/tmp/some-workspace";
    const skill = path.join(os.homedir(), ".agents", "skills", "glove", "SKILL.md");
    expect(() => resolveSafePath(ws, skill)).toThrow(/outside the workspace/);
  });
});
