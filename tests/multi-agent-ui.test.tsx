/**
 * Headless render + interaction tests for the Helix-style command palette and
 * the roster-based agent switcher. Uses OpenTUI's testRender to drive real
 * keyboard input and assert on the rendered character frame.
 */

import React from "react";
import { act } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { CommandPalette, type PaletteCommand } from "../src/tui/command-palette.tsx";
import { AgentManager } from "../src/tui/agent-manager.tsx";
import { initialUiState, type UiState } from "../src/tui/store-reducer.ts";
import type { AgentInfo } from "../src/shared/events.ts";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  act(() => { setup?.renderer.destroy(); });
  setup = undefined;
});

async function interact(fn: () => void | Promise<void>) {
  await act(async () => {
    await fn();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  await setup?.renderOnce();
}

const RENDER_OPTS = { width: 100, height: 30, kittyKeyboard: true } as const;

function rosterState(): UiState {
  const agents: AgentInfo[] = [
    { id: "main", label: "glorp", role: "general", active: true, busy: false, createdAt: 1, lastActiveAt: 1, turnCount: 0 },
    { id: "a_1", label: "scout", role: "researcher", active: false, busy: false, createdAt: 2, lastActiveAt: 2, turnCount: 3 },
  ];
  return { ...initialUiState, agents, activeAgentId: "main" };
}

function fakeClient() {
  const calls: Array<[string, string]> = [];
  const client = {
    switchAgent: (id: string) => calls.push(["switch", id]),
    addAgent: (role: string) => calls.push(["add", role]),
    removeAgent: (id: string) => calls.push(["remove", id]),
  } as any;
  return { calls, client };
}

describe("CommandPalette", () => {
  test("renders commands, fuzzy-filters on type, and runs the chosen one", async () => {
    const calls: string[] = [];
    let closed = false;
    const commands: PaletteCommand[] = [
      { id: "agents", label: "Manage agents", group: "Agents", run: () => calls.push("agents") },
      { id: "model", label: "Switch model", group: "Model", run: () => calls.push("model") },
      { id: "help", label: "Help and keybindings", group: "System", run: () => calls.push("help") },
    ];
    setup = await testRender(
      <CommandPalette commands={commands} onClose={() => { closed = true; }} />,
      RENDER_OPTS,
    );
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("commands");
    expect(frame).toContain("Manage agents");
    expect(frame).toContain("Switch model");

    await interact(() => { for (const ch of "model") setup!.mockInput.pressKey(ch); });
    frame = setup.captureCharFrame();
    expect(frame).toContain("Switch model");
    expect(frame).not.toContain("Manage agents");

    await interact(() => setup!.mockInput.pressEnter());
    expect(calls).toEqual(["model"]);
    expect(closed).toBe(true);
  });

  test("escape closes without running anything", async () => {
    const calls: string[] = [];
    let closed = false;
    setup = await testRender(
      <CommandPalette commands={[{ id: "x", label: "Quit", run: () => calls.push("x") }]} onClose={() => { closed = true; }} />,
      RENDER_OPTS,
    );
    await setup.renderOnce();
    await interact(() => setup!.mockInput.pressEscape());
    expect(closed).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("AgentManager (roster switcher)", () => {
  test("renders the roster and switches to the highlighted agent on Enter", async () => {
    const { calls, client } = fakeClient();
    let closed = false;
    setup = await testRender(
      <AgentManager client={client} state={rosterState()} onClose={() => { closed = true; }} />,
      RENDER_OPTS,
    );
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("glorp");
    expect(frame).toContain("scout");

    await interact(() => setup!.mockInput.pressArrow("down")); // highlight 'scout'
    await interact(() => setup!.mockInput.pressEnter());
    expect(calls).toContainEqual(["switch", "a_1"]);
    expect(closed).toBe(true);
  });

  test("'a' opens add mode listing roles, and Enter creates an agent", async () => {
    const { calls, client } = fakeClient();
    let closed = false;
    setup = await testRender(
      <AgentManager client={client} state={rosterState()} onClose={() => { closed = true; }} />,
      RENDER_OPTS,
    );
    await setup.renderOnce();
    await interact(() => setup!.mockInput.pressKey("a"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("researcher");
    expect(frame).toContain("reviewer");

    await interact(() => setup!.mockInput.pressEnter()); // first role
    expect(calls[0]?.[0]).toBe("add");
    expect(closed).toBe(true);
  });

  test("'x' removes the highlighted non-active agent", async () => {
    const { calls, client } = fakeClient();
    setup = await testRender(
      <AgentManager client={client} state={rosterState()} onClose={() => {}} />,
      RENDER_OPTS,
    );
    await setup.renderOnce();
    await interact(() => setup!.mockInput.pressArrow("down")); // 'scout'
    await interact(() => setup!.mockInput.pressKey("x"));
    expect(calls).toContainEqual(["remove", "a_1"]);
  });
});
