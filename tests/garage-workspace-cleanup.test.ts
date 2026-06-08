/**
 * Session destroy with `?workspace=true` must only delete a Garage-provisioned
 * sandbox (under workspaceRoot) that no other session references — never a
 * caller-supplied folder or a shared workspace. Guards the sharp edge where one
 * destroy could wipe a project shared by other sessions.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage, type GarageHandle } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";

const tmpDirs: string[] = [];
const garages: GarageHandle[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "wsclean-test-"));
  tmpDirs.push(d);
  return d;
}

async function boot() {
  const dataDir = tmp();
  const garage = await startGarage(loadGarageConfig({ hostname: "127.0.0.1", port: 0, dataDir }));
  garages.push(garage);
  return {
    base: `http://127.0.0.1:${garage.port}`,
    workspaceRoot: path.join(dataDir, "workspaces"),
  };
}

const create = (base: string, body: unknown) =>
  fetch(`${base}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()) as Promise<{ id: string; workspace: string }>;
const destroy = (base: string, id: string) =>
  fetch(`${base}/sessions/${id}?workspace=true`, { method: "DELETE" });

afterEach(async () => {
  for (const s of garages.splice(0)) await s.stop().catch(() => {});
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("destroy ?workspace=true cleanup guard", () => {
  it("never deletes a caller-supplied (external) folder", async () => {
    const { base } = await boot();
    const ext = tmp();
    fs.writeFileSync(path.join(ext, "keep.txt"), "important");
    const s = await create(base, { workspace: ext });
    expect((await destroy(base, s.id)).status).toBe(204);
    expect(fs.existsSync(path.join(ext, "keep.txt"))).toBe(true);
  });

  it("removes a Garage-provisioned sandbox with no other sessions", async () => {
    const { base } = await boot();
    const s = await create(base, {}); // auto-provisioned under workspaceRoot/<id>
    expect(fs.existsSync(s.workspace)).toBe(true);
    expect((await destroy(base, s.id)).status).toBe(204);
    expect(fs.existsSync(s.workspace)).toBe(false);
  });

  it("keeps a managed workspace while another session still uses it", async () => {
    const { base, workspaceRoot } = await boot();
    const shared = path.join(workspaceRoot, "shared-proj");
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, "code.ts"), "export const x = 1;");
    const s1 = await create(base, { workspace: shared });
    const s2 = await create(base, { workspace: shared });

    await destroy(base, s1.id);
    expect(fs.existsSync(shared)).toBe(true); // s2 still references it

    await destroy(base, s2.id);
    expect(fs.existsSync(shared)).toBe(false); // now safe to remove
  });
});
