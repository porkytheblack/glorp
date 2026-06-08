/**
 * End-to-end coverage for the per-session file-exchange endpoints
 * (`/sessions/:id/files`): upload via multipart, list, binary download,
 * delete, and the workspace-confinement guard against path traversal.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { loadGarageConfig } from "../src/garage/config.ts";
import { startGarage } from "../src/garage/server.ts";

const tmpDirs: string[] = [];
function tmp(prefix = "garage-files-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

describe("session file exchange", () => {
  it("uploads, lists, downloads, and deletes files in uploads/", async () => {
    const dataDir = tmp();
    const config = loadGarageConfig({ dataDir, port: await freePort(), hostname: "127.0.0.1" });
    const garage = await startGarage(config);
    const base = `http://127.0.0.1:${garage.port}`;

    try {
      const ws = path.join(dataDir, "explicit-ws");
      fs.mkdirSync(ws, { recursive: true });
      const created = await fetch(`${base}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: ws }),
      });
      const id = (await created.json()).id as string;

      // Upload via multipart/form-data.
      const form = new FormData();
      form.append("file", new Blob(["hello deck"]), "deck.txt");
      const up = await fetch(`${base}/sessions/${id}/files`, { method: "POST", body: form });
      expect(up.status).toBe(201);
      expect((await up.json()).files[0].path).toBe("deck.txt");

      // It lands in <workspace>/uploads/ where the agent can read it.
      expect(fs.readFileSync(path.join(ws, "uploads", "deck.txt"), "utf-8")).toBe("hello deck");

      // List reflects the upload with a correct size.
      const list = await (await fetch(`${base}/sessions/${id}/files`)).json();
      expect(list.files).toHaveLength(1);
      expect(list.files[0]).toMatchObject({ path: "deck.txt", size: 10 });

      // Download returns the exact bytes as an attachment.
      const dl = await fetch(`${base}/sessions/${id}/files/deck.txt`);
      expect(dl.status).toBe(200);
      expect(dl.headers.get("content-disposition")).toContain("deck.txt");
      expect(await dl.text()).toBe("hello deck");

      // Delete removes it from the listing.
      expect((await fetch(`${base}/sessions/${id}/files/deck.txt`, { method: "DELETE" })).status).toBe(204);
      expect((await (await fetch(`${base}/sessions/${id}/files`)).json()).files).toHaveLength(0);
    } finally {
      await garage.stop();
    }
  });

  it("rejects path traversal and never writes outside uploads/", async () => {
    const dataDir = tmp();
    const config = loadGarageConfig({ dataDir, port: await freePort(), hostname: "127.0.0.1" });
    const garage = await startGarage(config);
    const base = `http://127.0.0.1:${garage.port}`;

    try {
      const ws = path.join(dataDir, "ws");
      fs.mkdirSync(ws, { recursive: true });
      const id = (await (await fetch(`${base}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: ws }),
      })).json()).id as string;

      // Download with an escaping relative path is refused.
      const escaped = await fetch(`${base}/sessions/${id}/files/..%2F..%2Fsecret.txt`);
      expect(escaped.status).toBe(400);

      // Upload whose filename escapes uploads/ is rejected; nothing leaks out.
      const form = new FormData();
      form.append("file", new Blob(["x"]), "../escape.txt");
      const up = await fetch(`${base}/sessions/${id}/files`, { method: "POST", body: form });
      expect(up.status).toBe(400);
      expect(fs.existsSync(path.join(ws, "escape.txt"))).toBe(false);

      // Missing session → 404.
      expect((await fetch(`${base}/sessions/ghost/files`)).status).toBe(404);
    } finally {
      await garage.stop();
    }
  });
});
