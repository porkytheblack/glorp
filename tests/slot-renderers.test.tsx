import React from "react";
import { act } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { SelectOneSlot } from "../src/ui/slot-renderers/select-one.tsx";
import type { DisplaySlotEvent } from "../src/shared/events.ts";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;

async function renderSelectOne(callbacks: {
  onResolve?: (value: unknown) => void;
  onReject?: (reason?: string) => void;
}) {
  const slot: DisplaySlotEvent = {
    slotId: "slot-1",
    renderer: "select_one",
    input: {
      question: "How should this continue?",
      options: [
        { label: "Use sample data", value: "sample" },
        { label: "Paste content directly", value: "paste" },
      ],
    },
    createdAt: Date.now(),
    isPermissionRequest: false,
  };
  setup = await testRender(
    <SelectOneSlot
      slot={slot}
      onResolve={callbacks.onResolve ?? (() => {})}
      onReject={callbacks.onReject ?? (() => {})}
    />,
    { width: 100, height: 30, kittyKeyboard: true },
  );
  await setup.renderOnce();
  return setup;
}

async function interact(fn: () => void | Promise<void>) {
  await act(async () => {
    await fn();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await setup?.renderOnce();
}

function typeText(text: string) {
  for (const ch of text) setup?.mockInput.pressKey(ch);
}

afterEach(() => {
  act(() => {
    setup?.renderer.destroy();
  });
  setup = undefined;
});

describe("SelectOneSlot", () => {
  test("submits the highlighted option when no free-form answer is typed", async () => {
    const resolved: unknown[] = [];
    const t = await renderSelectOne({ onResolve: (value) => resolved.push(value) });

    await interact(() => t.mockInput.pressEnter());

    expect(resolved).toEqual(["sample"]);
  });

  test("allows a free-form answer for option prompts", async () => {
    const resolved: unknown[] = [];
    const t = await renderSelectOne({ onResolve: (value) => resolved.push(value) });

    await interact(() => typeText("use /tmp/indicators"));
    expect(t.captureCharFrame()).toContain("use /tmp/indicators");
    await interact(() => t.mockInput.pressEnter());

    expect(resolved).toEqual(["use /tmp/indicators"]);
  });

  test("escape rejects the slot", async () => {
    const rejected: string[] = [];
    const t = await renderSelectOne({ onReject: (reason) => rejected.push(reason ?? "") });

    await interact(() => t.mockInput.pressEscape());

    expect(rejected).toEqual(["cancelled"]);
  });
});
