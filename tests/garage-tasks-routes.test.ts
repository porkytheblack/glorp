/**
 * Task API over a real booted Garage — routing, the type catalog, validation,
 * provisioning, the projection, and cleanup. No model is configured, so the
 * worker's turn fails ("No model configured"); that's exactly enough to drive
 * create → provision → project → delete and assert the plumbing. The happy
 * path with a live agent lives in garage-task-e2e.test.ts (gated on a key).
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { startGarage } from "../src/garage/server.ts";
import { loadGarageConfig } from "../src/garage/config.ts";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "garage-tasks-"));
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

function withEchoTemplate(dataDir: string): void {
  const dir = path.join(dataDir, "templates");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "echo-task.json"),
    JSON.stringify({
      name: "echo-task",
      description: "Trivial task type for routing tests.",
      params: [{ name: "TONE", description: "Voice", default: "neutral" }],
      steps: [{ type: "shell", command: "mkdir -p uploads && printf hello > uploads/seed.txt" }],
      system_prompt: "You are a test worker.",
    }),
  );
}

async function boot() {
  const dataDir = tmp();
  withEchoTemplate(dataDir);
  const garage = await startGarage(
    loadGarageConfig({ dataDir, port: await freePort(), hostname: "127.0.0.1", workspaceRoot: path.join(dataDir, "ws") }),
  );
  const base = `http://127.0.0.1:${garage.port}/api/v1`;
  return { garage, base };
}

const poll = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 40): Promise<T> => {
  let last: T = await fn();
  for (let i = 0; i < tries && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 100));
    last = await fn();
  }
  return last;
};

describe("Task API routes", () => {
  it("lists task types projected from templates", async () => {
    const { garage, base } = await boot();
    try {
      const res = await fetch(`${base}/tasks/types`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { types: Array<{ name: string; inputs: Array<{ name: string; default: string | null }> }> };
      const echo = body.types.find((t) => t.name === "echo-task");
      expect(echo).toBeTruthy();
      expect(echo!.inputs[0]).toMatchObject({ name: "TONE", default: "neutral" });
    } finally {
      await garage.stop();
    }
  });

  it("validates the create body", async () => {
    const { garage, base } = await boot();
    try {
      const unknown = await fetch(`${base}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "nope", input: { prompt: "hi" } }) });
      expect(unknown.status).toBe(400);
      const noPrompt = await fetch(`${base}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "echo-task", input: {} }) });
      expect(noPrompt.status).toBe(400);
    } finally {
      await garage.stop();
    }
  });

  it("creates a task, provisions it, projects status + deliverable files, then deletes it", async () => {
    const { garage, base } = await boot();
    try {
      const created = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "echo-task", input: { prompt: "say hi", params: { TONE: "warm" } } }),
      });
      expect(created.status).toBe(202);
      const { id, status } = (await created.json()) as { id: string; status: string };
      expect(status).toBe("queued");

      // The shell step ran during provisioning (seed.txt), and the projection
      // surfaces it as a deliverable file — regardless of the turn's outcome
      // (this stays hermetic whether or not a model key is in the environment).
      const dto = await poll(
        async () => (await fetch(`${base}/tasks/${id}`).then((r) => r.json())) as { status: string; result: { files: Array<{ path: string }> }; usage: Record<string, unknown> },
        (d) => d.result.files.some((f) => f.path === "seed.txt"),
      );
      expect(dto.result.files.map((f) => f.path)).toContain("seed.txt");
      expect(["queued", "working", "needs_input", "completed", "failed"]).toContain(dto.status);

      // Every read reports a cumulative token + cost meter (zero here — no model
      // is configured — but always present, with tokens_total a true sum).
      const u = dto.usage as { tokens_in: number; tokens_out: number; tokens_total: number; cost_usd: number; cost_known: boolean };
      expect(u).toMatchObject({ tokens_in: 0, tokens_out: 0, tokens_total: 0, cost_usd: 0 });
      expect(u.tokens_total).toBe(u.tokens_in + u.tokens_out);
      expect(typeof u.cost_known).toBe("boolean");

      // Open-slots primitive is reachable for the same id.
      const slots = await fetch(`${base}/sessions/${id}/slots`).then((r) => r.json());
      expect(slots).toEqual({ slots: [] });

      // Listed, then deleted (session + workspace gone).
      const list = (await fetch(`${base}/tasks`).then((r) => r.json())) as { tasks: Array<{ id: string }> };
      expect(list.tasks.some((t) => t.id === id)).toBe(true);

      const del = await fetch(`${base}/tasks/${id}`, { method: "DELETE" });
      expect(del.status).toBe(204);
      expect((await fetch(`${base}/tasks/${id}`)).status).toBe(404);
    } finally {
      await garage.stop();
    }
  });

  it("defer_start stages the task, accepts an input upload, then starts it", async () => {
    const { garage, base } = await boot();
    try {
      const created = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "echo-task", input: { prompt: "use brief.txt" }, defer_start: true }),
      });
      expect(created.status).toBe(202);
      const { id } = (await created.json()) as { id: string };

      // Provisioning runs, but the first turn is withheld → "staged".
      const staged = await poll(
        async () => (await fetch(`${base}/tasks/${id}`).then((r) => r.json())) as { status: string },
        (d) => d.status === "staged",
      );
      expect(staged.status).toBe("staged");

      // An input upload lands in inputs/, listed + downloadable there.
      const form = new FormData();
      form.append("file", new Blob(["the brief"]), "brief.txt");
      const up = await fetch(`${base}/tasks/${id}/inputs`, { method: "POST", body: form });
      expect(up.status).toBe(201);
      const inputs = (await fetch(`${base}/tasks/${id}/inputs`).then((r) => r.json())) as { files: Array<{ path: string }> };
      expect(inputs.files.map((f) => f.path)).toContain("brief.txt");
      expect(await fetch(`${base}/tasks/${id}/inputs/brief.txt`).then((r) => r.text())).toBe("the brief");

      // Inputs are separate from deliverables: result.files has the uploads/ seed,
      // never the caller's input file.
      const dto = (await fetch(`${base}/tasks/${id}`).then((r) => r.json())) as { result: { files: Array<{ path: string }> } };
      expect(dto.result.files.map((f) => f.path)).toContain("seed.txt");
      expect(dto.result.files.map((f) => f.path)).not.toContain("brief.txt");

      // Start dispatches the held turn → the task leaves "staged"; a re-start conflicts.
      const start = await fetch(`${base}/tasks/${id}/start`, { method: "POST" });
      expect(start.status).toBe(202);
      const after = await poll(
        async () => (await fetch(`${base}/tasks/${id}`).then((r) => r.json())) as { status: string },
        (d) => d.status !== "staged",
      );
      expect(after.status).not.toBe("staged");
      expect((await fetch(`${base}/tasks/${id}/start`, { method: "POST" })).status).toBe(409);
    } finally {
      await garage.stop();
    }
  });

  it("rejects start on a task that was not deferred", async () => {
    const { garage, base } = await boot();
    try {
      const created = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "echo-task", input: { prompt: "go" } }),
      });
      const { id } = (await created.json()) as { id: string };
      expect((await fetch(`${base}/tasks/${id}/start`, { method: "POST" })).status).toBe(409);
    } finally {
      await garage.stop();
    }
  });

  it("fills an operator-managed param server-side and hides it from the catalog", async () => {
    const dataDir = tmp();
    const tdir = path.join(dataDir, "templates");
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(
      path.join(tdir, "needs-infra.json"),
      JSON.stringify({
        name: "needs-infra",
        description: "Requires an infra secret the operator manages.",
        params: [{ name: "INFRA_KEY", description: "render key", required: true, secret: true }],
        steps: [{ type: "shell", command: "mkdir -p uploads && printf '%s' '{param:INFRA_KEY}' > uploads/key.txt" }],
        system_prompt: "test",
      }),
    );
    process.env.GLORP_GARAGE_TASK_PARAM_INFRA_KEY = "sk-managed-123";
    let garage: Awaited<ReturnType<typeof startGarage>> | undefined;
    try {
      // Inside try so the finally always clears the env var, even if startup throws.
      garage = await startGarage(
        loadGarageConfig({ dataDir, port: await freePort(), hostname: "127.0.0.1", workspaceRoot: path.join(dataDir, "ws") }),
      );
      const base = `http://127.0.0.1:${garage.port}/api/v1`;
      // The managed param does not appear in the type's inputs.
      const types = (await fetch(`${base}/tasks/types`).then((r) => r.json())) as { types: Array<{ name: string; inputs: Array<{ name: string }> }> };
      const t = types.types.find((x) => x.name === "needs-infra")!;
      expect(t.inputs.find((i) => i.name === "INFRA_KEY")).toBeUndefined();

      // Submitting WITHOUT the param succeeds, and the managed value is used.
      const created = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "needs-infra", input: { prompt: "go" } }),
      });
      expect(created.status).toBe(202);
      const { id } = (await created.json()) as { id: string };
      await poll(
        async () => (await fetch(`${base}/tasks/${id}`).then((r) => r.json())) as { result: { files: Array<{ path: string }> } },
        (d) => d.result.files.some((f) => f.path === "key.txt"),
      );
      const value = await fetch(`${base}/tasks/${id}/files/key.txt`).then((r) => r.text());
      expect(value).toBe("sk-managed-123");
    } finally {
      delete process.env.GLORP_GARAGE_TASK_PARAM_INFRA_KEY;
      if (garage) await garage.stop();
    }
  });
});
