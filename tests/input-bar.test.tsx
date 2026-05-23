import React from "react";
import { act } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { InputBar, findActiveHintToken, normalizeSkillAlias } from "../src/ui/components/input-bar.tsx";
import type { SlashCommand } from "../src/ui/components/slash-menu.tsx";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await setup?.renderOnce();
}

async function interact(fn: () => void | Promise<void>) {
  await act(async () => {
    await fn();
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  for (let i = 0; i < 2; i++) {
    await setup?.renderOnce();
  }
}

function typeText(text: string) {
  for (const ch of text) setup?.mockInput.pressKey(ch);
}

async function renderInputBar(options?: {
  onSubmit?: (text: string) => void;
  onHeightChange?: (height: number) => void;
  slashCommands?: SlashCommand[];
  skillHints?: SlashCommand[];
  subagentMentions?: SlashCommand[];
}) {
  setup = await testRender(
    <InputBar
      busy={false}
      width={80}
      modelLabel="test-model"
      slashCommands={options?.slashCommands ?? [
        { name: "/plan", description: "switch to plan mode" },
        { name: "/compact", description: "compact context" },
      ]}
      skillHints={options?.skillHints ?? [
        { name: "$concise", description: "trim verbosity" },
        { name: "$glove", description: "Glove framework guide" },
      ]}
      subagentMentions={options?.subagentMentions ?? [
        { name: "@researcher", description: "investigate" },
        { name: "@reviewer", description: "review" },
      ]}
      onSubmit={options?.onSubmit ?? (() => {})}
      onAbort={() => {}}
      onQuit={() => {}}
      onHeightChange={options?.onHeightChange}
    />,
    { width: 90, height: 24, kittyKeyboard: true },
  );
  await settle();
  return setup;
}

afterEach(() => {
  act(() => {
    setup?.renderer.destroy();
  });
  setup = undefined;
});

describe("InputBar", () => {
  test("finds the active hint token at the cursor", () => {
    expect(findActiveHintToken("ask /plan then /co later", 18)).toEqual({
      query: "/co",
      start: 15,
      end: 18,
      trigger: "/",
    });
    expect(findActiveHintToken("ask @reviewer then (@res", 24)).toEqual({
      query: "@res",
      start: 20,
      end: 24,
      trigger: "@",
    });
    expect(findActiveHintToken("email don@example.com")).toBeNull();
  });

  test("shows and completes slash command hints", async () => {
    const t = await renderInputBar();

    await interact(() => typeText("/pl"));
    expect(t.captureCharFrame()).toContain("slash commands");
    expect(t.captureCharFrame()).toContain("/plan");

    await interact(() => t.mockInput.pressTab());
    const frame = t.captureCharFrame();
    expect(frame).toContain("/plan");
    expect(frame).not.toContain("› /pl ");
  });

  test("keeps cursor after completed slash hint", async () => {
    const t = await renderInputBar();

    await interact(() => typeText("/pl"));
    await interact(() => t.mockInput.pressTab());
    await interact(() => typeText("now"));

    const frame = t.captureCharFrame();
    expect(frame).toContain("/plan now");
    expect(frame).not.toContain("now/plan");
  });

  test("shows slash hints for the second slash token even before trailing text", async () => {
    const t = await renderInputBar();

    await interact(() => typeText("ask /plan then /co later"));
    await interact(() => {
      for (let i = 0; i < " later".length; i++) t.mockInput.pressArrow("left");
    });
    expect(t.captureCharFrame()).toContain("slash commands");
    expect(t.captureCharFrame()).toContain("/compact");

    await interact(() => t.mockInput.pressTab());
    await interact(() => typeText("now "));
    const frame = t.captureCharFrame();
    expect(frame).toContain("ask /plan then /compact now later");
    expect(frame).toContain("later");
  });

  test("scrolls slash command hints as the selection moves past visible rows", async () => {
    const slashCommands = Array.from({ length: 12 }, (_, i) => ({
      name: `/item${String(i).padStart(2, "0")}`,
      description: `command ${i}`,
    }));
    const t = await renderInputBar({ slashCommands });

    await interact(() => typeText("/"));
    expect(t.captureCharFrame()).toContain("/item00");
    expect(t.captureCharFrame()).not.toContain("/item10");

    await interact(() => {
      for (let i = 0; i < 10; i++) t.mockInput.pressArrow("down");
    });

    const frame = t.captureCharFrame();
    expect(frame).toContain("showing 4-11");
    expect(frame).toContain("/item10");
    expect(frame).not.toContain("/item00");

    await interact(() => t.mockInput.pressTab());
    expect(t.captureCharFrame()).toContain("/item10 ");
  });

  test("shows skill hints for $skill and completes to slash invocation", async () => {
    const submitted: string[] = [];
    const t = await renderInputBar({ onSubmit: (text) => submitted.push(text) });

    await interact(() => typeText("$glo"));
    expect(t.captureCharFrame()).toContain("skills");
    expect(t.captureCharFrame()).toContain("$glove");

    await interact(() => t.mockInput.pressTab());
    expect(t.captureCharFrame()).toContain("/glove");

    await interact(() => t.mockInput.pressEnter());
    expect(submitted).toEqual(["/glove"]);
  });

  test("normalizes a leading $skill on submit even without tab completion", () => {
    expect(
      normalizeSkillAlias("$glove inspect this", [
        { name: "$glove", description: "Glove framework guide" },
      ]),
    ).toBe("/glove inspect this");
    expect(normalizeSkillAlias("ask about $glove", [{ name: "$glove", description: "guide" }])).toBe(
      "ask about $glove",
    );
  });

  test("shows and completes subagent mentions", async () => {
    const t = await renderInputBar();

    await interact(() => typeText("@res"));
    expect(t.captureCharFrame()).toContain("subagents");
    expect(t.captureCharFrame()).toContain("@researcher");

    await interact(() => t.mockInput.pressTab());
    expect(t.captureCharFrame()).toContain("@researcher");
  });

  test("shows subagent hints for a later @ mention before trailing text", async () => {
    const t = await renderInputBar();

    await interact(() => typeText("ask @reviewer then @res later"));
    await interact(() => {
      for (let i = 0; i < " later".length; i++) t.mockInput.pressArrow("left");
    });
    expect(t.captureCharFrame()).toContain("subagents");
    expect(t.captureCharFrame()).toContain("@researcher");

    await interact(() => t.mockInput.pressTab());
    const frame = t.captureCharFrame();
    expect(frame).toContain("ask @reviewer then @researcher");
    expect(frame).toContain("later");
  });

  test("shift-enter inserts a newline and reports expanded height", async () => {
    const heights: number[] = [];
    const t = await renderInputBar({ onHeightChange: (height) => heights.push(height) });

    await interact(() => typeText("line one"));
    await interact(() => t.mockInput.pressEnter({ shift: true }));
    await interact(() => typeText("line two"));

    const frame = t.captureCharFrame();
    expect(frame).toContain("line one");
    expect(frame).toContain("line two");
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(5);
  });
});
