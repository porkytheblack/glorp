import { describe, test, expect } from "bun:test";
import {
  askConfirmTool,
  showInfoTool,
  askChoiceTool,
  askTextTool,
} from "../src/agent/tools/modals.ts";

/**
 * Verify each modal tool pushes a slot with the right renderer name and
 * input shape, and resolves/forwards the user's response correctly.
 * `display` here is a minimal stub that captures the push + lets us
 * synchronously resolve with a canned answer.
 */
function makeDisplay(canned: unknown) {
  return {
    pushed: null as { renderer: string; input: unknown } | null,
    pushAndWait(slot: { renderer: string; input: unknown }) {
      this.pushed = slot;
      return Promise.resolve(canned);
    },
    pushAndForget() {
      return Promise.resolve("noop");
    },
  };
}

const glove: any = {};

describe("askConfirmTool", () => {
  test("pushes a 'confirm' slot with the message", async () => {
    const dm = makeDisplay(true);
    const result = await askConfirmTool.do(
      { message: "delete it?", danger: true },
      dm as any,
      glove,
    );
    expect(dm.pushed?.renderer).toBe("confirm");
    expect((dm.pushed?.input as any).message).toBe("delete it?");
    expect((dm.pushed?.input as any).danger).toBe(true);
    expect(result.status).toBe("success");
    expect(result.data).toBe("yes");
  });

  test("returns 'no' when the user denies", async () => {
    const dm = makeDisplay(false);
    const result = await askConfirmTool.do({ message: "ok?" }, dm as any, glove);
    expect(result.data).toBe("no");
    expect((result.renderData as any).answer).toBe(false);
  });

  test("Zod requires a non-empty message", () => {
    const r = askConfirmTool.inputSchema!.safeParse({ message: "" });
    expect(r.success).toBe(false);
  });
});

describe("showInfoTool", () => {
  test("pushes an 'info' slot and returns 'dismissed'", async () => {
    const dm = makeDisplay(true);
    const result = await showInfoTool.do(
      { title: "hi", message: "all good", severity: "success" },
      dm as any,
      glove,
    );
    expect(dm.pushed?.renderer).toBe("info");
    expect(result.status).toBe("success");
    expect(result.data).toBe("dismissed");
  });

  test("severity is optional, defaults are fine", () => {
    const r = showInfoTool.inputSchema!.safeParse({ message: "x" });
    expect(r.success).toBe(true);
  });

  test("severity must be one of the enum values", () => {
    const r = showInfoTool.inputSchema!.safeParse({
      message: "x",
      severity: "wat",
    });
    expect(r.success).toBe(false);
  });
});

describe("askChoiceTool", () => {
  test("pushes a 'select_one' slot and returns the chosen value", async () => {
    const dm = makeDisplay("yes");
    const result = await askChoiceTool.do(
      {
        question: "pick",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
      },
      dm as any,
      glove,
    );
    expect(dm.pushed?.renderer).toBe("select_one");
    expect(result.data).toBe("yes");
    expect((result.renderData as any).chosen).toBe("yes");
  });

  test("requires at least 2 options", () => {
    const r = askChoiceTool.inputSchema!.safeParse({
      question: "x",
      options: [{ label: "only one" }],
    });
    expect(r.success).toBe(false);
  });

  test("caps at 12 options", () => {
    const opts = Array.from({ length: 13 }, (_, i) => ({ label: `o${i}` }));
    const r = askChoiceTool.inputSchema!.safeParse({ question: "x", options: opts });
    expect(r.success).toBe(false);
  });
});

describe("askTextTool", () => {
  test("pushes a 'text_input' slot and returns the typed answer", async () => {
    const dm = makeDisplay("hello world");
    const result = await askTextTool.do(
      { question: "your name?", placeholder: "name" },
      dm as any,
      glove,
    );
    expect(dm.pushed?.renderer).toBe("text_input");
    expect(result.data).toBe("hello world");
    expect((result.renderData as any).answer).toBe("hello world");
  });

  test("requires a question", () => {
    const r = askTextTool.inputSchema!.safeParse({});
    expect(r.success).toBe(false);
  });
});
