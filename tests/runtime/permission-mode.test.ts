import { describe, test, expect } from "bun:test";
import { Displaymanager } from "glove-core/display-manager";
import { PermissionDM, nextPermissionMode, type PermissionMode } from "../../src/agent/runtime/permission-mode.ts";

/** Minimal DM that records pushAndWait calls and resolves them. */
function makeMockDM() {
  const calls: Array<{ renderer: string; input: unknown }> = [];
  const dm = new Displaymanager();
  dm.pushAndWait = async <I, O>(slot: any): Promise<O> => {
    calls.push({ renderer: slot.renderer, input: slot.input });
    if (slot.renderer === "confirm") return true as O;
    if (slot.renderer === "select_one") return "option_a" as O;
    if (slot.renderer === "text_input") return "typed text" as O;
    if (slot.renderer === "info") return undefined as O;
    return true as O;
  };
  return { dm, calls };
}

function wrap(mode: PermissionMode) {
  const { dm, calls } = makeMockDM();
  return { wrapped: new PermissionDM(dm, mode), calls };
}

describe("PermissionDM — normal mode", () => {
  test("forwards all pushAndWait to inner DM", async () => {
    const { wrapped, calls } = wrap("normal");
    await wrapped.pushAndWait({ renderer: "permission_request", input: { tool: "bash" } });
    expect(calls).toHaveLength(1);
  });
});

describe("PermissionDM — bypass mode", () => {
  test("auto-approves permission_request", async () => {
    const { wrapped, calls } = wrap("bypass");
    const result = await wrapped.pushAndWait({ renderer: "permission_request", input: { tool: "bash" } });
    expect(result).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("auto-approves confirm (non-dangerous)", async () => {
    const { wrapped, calls } = wrap("bypass");
    const result = await wrapped.pushAndWait({ renderer: "confirm", input: { message: "ok?" } });
    expect(result).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("auto-approves confirm (dangerous)", async () => {
    const { wrapped, calls } = wrap("bypass");
    const result = await wrapped.pushAndWait({
      renderer: "confirm", input: { message: "rm -rf?", danger: true },
    });
    expect(result).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("auto-dismisses info", async () => {
    const { wrapped, calls } = wrap("bypass");
    const result = await wrapped.pushAndWait({ renderer: "info", input: { message: "FYI" } });
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("forwards select_one to user", async () => {
    const { wrapped, calls } = wrap("bypass");
    const result = await wrapped.pushAndWait({ renderer: "select_one", input: { question: "Pick" } });
    expect(result).toBe("option_a");
    expect(calls).toHaveLength(1);
  });

  test("forwards text_input to user", async () => {
    const { wrapped, calls } = wrap("bypass");
    const result = await wrapped.pushAndWait({ renderer: "text_input", input: { question: "Name?" } });
    expect(result).toBe("typed text");
    expect(calls).toHaveLength(1);
  });
});

describe("PermissionDM — auto mode", () => {
  test("auto-approves permission_request", async () => {
    const { wrapped, calls } = wrap("auto");
    const result = await wrapped.pushAndWait({ renderer: "permission_request", input: { tool: "edit" } });
    expect(result).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("auto-approves non-dangerous confirm", async () => {
    const { wrapped, calls } = wrap("auto");
    const result = await wrapped.pushAndWait({ renderer: "confirm", input: { message: "Proceed?" } });
    expect(result).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("escalates dangerous confirm to user", async () => {
    const { wrapped, calls } = wrap("auto");
    const result = await wrapped.pushAndWait({
      renderer: "confirm", input: { message: "git push --force?", danger: true },
    });
    expect(result).toBe(true); // mock user approves
    expect(calls).toHaveLength(1);
    expect(calls[0].renderer).toBe("confirm");
  });

  test("forwards select_one to user", async () => {
    const { wrapped, calls } = wrap("auto");
    const result = await wrapped.pushAndWait({ renderer: "select_one", input: { question: "Pick" } });
    expect(result).toBe("option_a");
    expect(calls).toHaveLength(1);
  });

  test("forwards text_input to user", async () => {
    const { wrapped, calls } = wrap("auto");
    const result = await wrapped.pushAndWait({ renderer: "text_input", input: { question: "Desc" } });
    expect(result).toBe("typed text");
    expect(calls).toHaveLength(1);
  });

  test("forwards info to user", async () => {
    const { wrapped, calls } = wrap("auto");
    const result = await wrapped.pushAndWait({ renderer: "info", input: { message: "Status" } });
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe("PermissionDM — runtime mode switching", () => {
  test("mode can be changed at runtime", async () => {
    const { dm, calls } = makeMockDM();
    const pdm = new PermissionDM(dm, "normal");
    // Normal: forwards to inner
    await pdm.pushAndWait({ renderer: "permission_request", input: {} });
    expect(calls).toHaveLength(1);
    // Switch to auto
    pdm.mode = "auto";
    expect(pdm.mode).toBe("auto");
    await pdm.pushAndWait({ renderer: "permission_request", input: {} });
    expect(calls).toHaveLength(1); // no new call — auto-approved
    // Switch to bypass
    pdm.mode = "bypass";
    await pdm.pushAndWait({ renderer: "confirm", input: { danger: true } });
    expect(calls).toHaveLength(1); // still no new call — bypass even danger
  });

  test("delegates pushAndForget to inner DM", async () => {
    const { dm } = makeMockDM();
    const pdm = new PermissionDM(dm, "auto");
    const id = await pdm.pushAndForget({ renderer: "test", input: {} });
    expect(typeof id).toBe("string");
  });
});

describe("nextPermissionMode", () => {
  test("cycles normal → auto → bypass → normal", () => {
    expect(nextPermissionMode("normal")).toBe("auto");
    expect(nextPermissionMode("auto")).toBe("bypass");
    expect(nextPermissionMode("bypass")).toBe("normal");
  });
});
