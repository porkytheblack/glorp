import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildResourcesCuratorTools, type Provenance } from "glove-memory";
import { FileResourcesAdapter } from "../src/agent/resources/file-adapter.ts";
import { createGlorpMemorySchema } from "../src/agent/resources/schema.ts";

let dataDir: string;

const provenance = (): Provenance => ({
  source: "test",
  actor: "test-runner",
  timestamp: new Date().toISOString(),
});

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-resources-"));
});

afterEach(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

function adapter(sessionId = "session-1") {
  return new FileResourcesAdapter({
    dataDir,
    sessionId,
    schema: createGlorpMemorySchema(),
  });
}

describe("FileResourcesAdapter", () => {
  test("writes, reads, lists, greps, and globs session resources", async () => {
    const resources = adapter();
    await resources.write(
      "/notes/decision.md",
      { type: "markdown", text: "Decision: use file adapters\nReason: durable sessions" },
      { summary: "Storage decision", tags: ["decision"], links: [] },
      provenance(),
    );

    expect((await resources.read("/notes/decision.md", { range: [1, -1] })).body).toEqual({
      type: "markdown",
      text: "Decision: use file adapters\nReason: durable sessions",
    });
    expect((await resources.list("/notes"))[0]?.path).toBe("/notes/decision.md");
    expect((await resources.grep({ query: "durable", path: "/notes" }))[0]?.line).toBe(2);
    expect(await resources.glob("**/*.md", { path: "/notes" })).toEqual(["/notes/decision.md"]);
  });

  test("edits unique text and persists across adapter instances", async () => {
    const first = adapter("persist-1");
    await first.write(
      "/research/findings.txt",
      { type: "text", text: "alpha\nbeta\ngamma" },
      { tags: [], links: [] },
      provenance(),
    );
    await first.edit("/research/findings.txt", "beta", "BETA", provenance());

    const second = adapter("persist-1");
    const file = await second.read("/research/findings.txt", { range: [1, -1] });
    expect(file.body).toEqual({ type: "text", text: "alpha\nBETA\ngamma" });
    expect(file.provenance.length).toBe(2);
  });

  test("requires recursive removal for non-empty directories", async () => {
    const resources = adapter();
    await resources.write(
      "/artifacts/report.txt",
      { type: "text", text: "report" },
      { tags: [], links: [] },
      provenance(),
    );
    await expect(resources.remove("/artifacts", false, provenance())).rejects.toThrow(/not empty/);
    await resources.remove("/artifacts", true, provenance());
    expect(await resources.exists("/artifacts/report.txt")).toBe(false);
  });

  test("tracks resource links and can rewrite targets", async () => {
    const resources = adapter();
    await resources.write(
      "/subagents/review.md",
      { type: "markdown", text: "Review handoff" },
      { tags: ["subagent"], links: [{ kind: "resource", id: "/plans/current.md" }] },
      provenance(),
    );
    expect(await resources.linksFor("resource", "/plans/current.md")).toEqual(["/subagents/review.md"]);
    expect(await resources.replaceLinkTarget("resource", "/plans/current.md", "/plans/revised.md", provenance())).toEqual({ updated: 1 });
    expect(await resources.linksFor("resource", "/plans/revised.md")).toEqual(["/subagents/review.md"]);
  });

  test("curator tools write and edit resources with default provenance", async () => {
    const resources = adapter();
    const tools = buildResourcesCuratorTools(resources);
    const write = tools.find((tool) => tool.name === "glove_resources_write")!;
    const edit = tools.find((tool) => tool.name === "glove_resources_edit")!;
    const written = await write.do({
      path: "/notes/run.md",
      body: { type: "markdown", text: "status: pending" },
    });
    expect(written.status).toBe("success");
    const edited = await edit.do({
      path: "/notes/run.md",
      oldStr: "pending",
      newStr: "complete",
    });
    expect(edited.status).toBe("success");
    expect((await resources.read("/notes/run.md", { range: [1, -1] })).body).toEqual({
      type: "markdown",
      text: "status: complete",
    });
  });
});
