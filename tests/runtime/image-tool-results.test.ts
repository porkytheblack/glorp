import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Message } from "glove-core/core";

import { viewImageTool, GLORP_IMAGE_RENDER_KEY } from "../../src/agent/tools/view-image.ts";
import { injectImageMessages } from "../../src/agent/runtime/image-tool-results.ts";
import { VerificationTracker } from "../../src/agent/runtime/verification-tracker.ts";

const display: any = {};
const glove: any = {};

// 8-byte PNG signature + a little filler; sniffMediaType only reads the header.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("glorp-test-image"),
]);

let workspace: string;
beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), "glorp-img-")); });
afterEach(() => { try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {} });

function writeFile(rel: string, buf: Buffer): string {
  const abs = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel;
}

describe("viewImageTool", () => {
  test("loads a PNG and stashes base64 on renderData (not in model-facing data)", async () => {
    writeFile("shot.png", PNG_BYTES);
    const res = await viewImageTool(workspace).do({ path: "shot.png" }, display, glove);
    expect(res.status).toBe("success");
    expect(res.data).toContain("shot.png");
    expect(res.data).toContain("image/png");
    const img = (res.renderData as any)[GLORP_IMAGE_RENDER_KEY];
    expect(img.media_type).toBe("image/png");
    expect(img.data).toBe(PNG_BYTES.toString("base64"));
    // The heavy payload must not be in the text the model sees.
    expect(String(res.data)).not.toContain(img.data);
  });

  test("rejects a non-image file type", async () => {
    writeFile("notes.txt", Buffer.from("hello"));
    const res = await viewImageTool(workspace).do({ path: "notes.txt" }, display, glove);
    expect(res.status).toBe("error");
    expect(res.message).toContain("Unsupported image type");
  });

  test("rejects a missing file", async () => {
    const res = await viewImageTool(workspace).do({ path: "nope.png" }, display, glove);
    expect(res.status).toBe("error");
    expect(res.message).toContain("Not a file");
  });

  test("rejects a file with no recognizable image header", async () => {
    writeFile("fake.png", Buffer.from("this is plainly not a png"));
    const res = await viewImageTool(workspace).do({ path: "fake.png" }, display, glove);
    expect(res.status).toBe("error");
    expect(res.message).toContain("recognizable image header");
  });

  test("rejects when the extension and the real type disagree", async () => {
    // JPEG magic bytes (FF D8 FF) under a .png name.
    writeFile("mislabeled.png", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("jpegdata")]));
    const res = await viewImageTool(workspace).do({ path: "mislabeled.png" }, display, glove);
    expect(res.status).toBe("error");
    expect(res.message).toContain("bytes look like image/jpeg");
  });
});

describe("injectImageMessages", () => {
  const imageResultMessage = (data: string): Message => ({
    sender: "user",
    text: "tool results",
    tool_results: [
      { tool_name: "view_image", result: { status: "success", data: "Loaded shot.png", renderData: { [GLORP_IMAGE_RENDER_KEY]: { media_type: "image/png", data } } } },
    ],
  } as any);

  test("returns the same array when there are no image tool results (fast path)", () => {
    const messages: Message[] = [
      { sender: "user", text: "hi" } as Message,
      { sender: "agent", text: "ok" } as Message,
    ];
    expect(injectImageMessages(messages)).toBe(messages);
  });

  test("splices an image content message right after the tool-result message", () => {
    const messages: Message[] = [
      { sender: "agent", text: "", tool_calls: [{ tool_name: "view_image", input_args: {}, id: "t1" }] } as any,
      imageResultMessage("BASE64DATA"),
      { sender: "agent", text: "I can see it" } as Message,
    ];
    const out = injectImageMessages(messages);
    expect(out).not.toBe(messages);
    expect(out).toHaveLength(4);
    const injected = out[2];
    expect(injected.sender).toBe("user");
    expect(injected.content?.[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "BASE64DATA" },
    });
    // tool-result message stays put; agent reply still follows the injection.
    expect(out[1].tool_results).toBeDefined();
    expect(out[3].text).toBe("I can see it");
  });

  test("caps the number of injected images to the most recent few", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 7; i++) messages.push(imageResultMessage(`IMG${i}`));
    const out = injectImageMessages(messages);
    const injectedData = out
      .filter((m) => m.content?.some((p) => p.type === "image"))
      .map((m) => (m.content![0] as any).source.data);
    expect(injectedData).toEqual(["IMG3", "IMG4", "IMG5", "IMG6"]);
  });
});

describe("VerificationTracker — view_image as a visual check", () => {
  test("viewing an image clears pending web and presentation work", () => {
    const t = new VerificationTracker();
    t.observe("write", { path: "site/index.html" }, { status: "success", data: "ok" });
    t.observe("write", { path: "deck.pptx" }, { status: "success", data: "ok" });
    t.observe("write", { path: "src/app.ts" }, { status: "success", data: "ok" });
    t.observe("view_image", { path: "shot.png" }, { status: "success", data: "ok" });
    // Visual deliverables cleared; code still needs an objective check.
    expect(t.status().pendingFiles).toEqual(["src/app.ts"]);
  });
});
