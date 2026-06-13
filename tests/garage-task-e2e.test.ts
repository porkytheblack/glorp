/**
 * Live task happy-path — gated on GLORP_E2E_KEY (an Anthropic key), so it skips
 * in CI. Proves the real chain a task-aware agent runs: a worker is told (via
 * the task preamble + a template nudge) to call deliver_result, and the Task
 * API surfaces that declared deliverable as the completed result.
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";

const KEY = process.env.GLORP_E2E_KEY;
const run = KEY ? describe : describe.skip;

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "garage-task-e2e-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => resolve(typeof a === "object" && a ? a.port : 0));
    });
  });
}

run("Task API — live happy path", () => {
  it("delivers a declared result and surfaces it as completed", async () => {
    if (KEY) process.env.ANTHROPIC_API_KEY = KEY;
    const dataDir = tmp();
    const tdir = path.join(dataDir, "templates");
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(
      path.join(tdir, "deliver-demo.json"),
      JSON.stringify({
        name: "deliver-demo",
        description: "Writes a file and declares it.",
        system_prompt:
          "Do exactly this and nothing else: write the text 'hi there' to ./uploads/note.txt, then call deliver_result with summary 'greeting written' and files ['uploads/note.txt']. Then stop.",
      }),
    );
    const garage = await startGarage(
      loadGarageConfig({ dataDir, port: await freePort(), hostname: "127.0.0.1", workspaceRoot: path.join(dataDir, "ws") }),
    );
    const base = `http://127.0.0.1:${garage.port}/api/v1`;
    try {
      const created = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "deliver-demo", input: { prompt: "go" } }),
      });
      expect(created.status).toBe(202);
      const { id } = (await created.json()) as { id: string };

      let dto: any = {};
      for (let i = 0; i < 120; i++) {
        dto = await fetch(`${base}/tasks/${id}`).then((r) => r.json());
        if (dto.status === "completed" || dto.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(dto.status).toBe("completed");
      expect(dto.result.summary).toContain("greeting");
      expect(dto.result.files.map((f: { path: string }) => f.path)).toContain("note.txt");

      const file = await fetch(`${base}/sessions/${id}/files/note.txt`).then((r) => r.text());
      expect(file).toContain("hi there");
    } finally {
      await garage.stop();
    }
  }, 180_000);
});
