import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";

/**
 * Four agent-callable tools that push slots onto the display stack and
 * wait for the user's response. They map 1:1 onto the built-in slot
 * renderers in `src/ui/slot-renderers/`.
 *
 * The TUI's renderer registry decides how each slot is displayed; the
 * tools here only own the schema + the pushAndWait wire-up. Adding a
 * new modal is a matter of: (1) write a renderer, (2) register it in
 * `slot-renderers/index.tsx`, (3) optionally add a thin tool here.
 */

export const askConfirmTool: GloveFoldArgs<{
  message: string;
  yesLabel?: string;
  noLabel?: string;
  danger?: boolean;
}> = {
  name: "ask_confirm",
  description:
    "Ask the user a yes/no question and block until they answer. Use BEFORE any destructive operation, OR when the user's intent is ambiguous and a single decision unblocks the work. Returns 'yes' or 'no'.",
  inputSchema: z.object({
    message: z.string().min(1).describe("The question to ask, ending with '?'"),
    yesLabel: z.string().optional().describe("Custom label for the yes button (e.g. 'delete')"),
    noLabel: z.string().optional().describe("Custom label for the no button (e.g. 'keep')"),
    danger: z
      .boolean()
      .optional()
      .describe("Set true for destructive actions — renders the prompt in a warning style"),
  }),
  async do(input, display) {
    const allowed = (await display.pushAndWait({
      renderer: "confirm",
      input,
    })) as boolean;
    return {
      status: "success",
      data: allowed ? "yes" : "no",
      renderData: { ...input, answer: allowed },
    };
  },
};

export const showInfoTool: GloveFoldArgs<{
  title?: string;
  message: string;
  severity?: "info" | "success" | "warning" | "error";
}> = {
  name: "show_info",
  description:
    "Display an informational card to the user and wait for them to dismiss it. Use to surface a result or status that the user should explicitly acknowledge before the agent continues. Returns 'dismissed'.",
  inputSchema: z.object({
    title: z.string().max(80).optional().describe("Short card title (max 80 chars)"),
    message: z.string().min(1).describe("Body text; newlines preserved"),
    severity: z
      .enum(["info", "success", "warning", "error"])
      .optional()
      .describe("Affects the card's border colour"),
  }),
  async do(input, display) {
    await display.pushAndWait({ renderer: "info", input });
    return { status: "success", data: "dismissed", renderData: input };
  },
};

export const askChoiceTool: GloveFoldArgs<{
  question: string;
  options: Array<{ label: string; value?: string; description?: string }>;
}> = {
  name: "ask_choice",
  description:
    "Ask the user to pick ONE option from a list. Use when several distinct routes are possible and the user's preference can't be inferred. Returns the chosen option's `value` (or `label` if value was omitted).",
  inputSchema: z.object({
    question: z.string().min(1).describe("Prompt shown above the list"),
    options: z
      .array(
        z.object({
          label: z.string().describe("What the user sees in the list"),
          value: z.string().optional().describe("What's returned to you (defaults to label)"),
          description: z.string().optional().describe("One-line hint shown when highlighted"),
        }),
      )
      .min(2)
      .max(12),
  }),
  async do(input, display) {
    const value = (await display.pushAndWait({
      renderer: "select_one",
      input,
    })) as string;
    return {
      status: "success",
      data: value,
      renderData: { ...input, chosen: value },
    };
  },
};

export const askTextTool: GloveFoldArgs<{
  question: string;
  placeholder?: string;
  initial?: string;
}> = {
  name: "ask_text",
  description:
    "Ask the user for a free-form text response and block until they submit. Use for a single piece of missing information (a name, a URL, a paragraph of clarification). Returns the user's input as a string.",
  inputSchema: z.object({
    question: z.string().min(1).describe("Prompt shown above the input"),
    placeholder: z.string().optional().describe("Hint shown inside the empty input"),
    initial: z.string().optional().describe("Pre-fill the input with this value"),
  }),
  async do(input, display) {
    const value = (await display.pushAndWait({
      renderer: "text_input",
      input,
    })) as string;
    return {
      status: "success",
      data: value,
      renderData: { ...input, answer: value },
    };
  },
};
