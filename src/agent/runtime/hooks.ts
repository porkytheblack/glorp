import type { Glove } from "glove-core/glove";

export const HOOK_DESCRIPTIONS: Record<string, string> = {
  plan: "switch to plan-first mode for this turn",
  build: "orchestrate a multi-agent plan-and-build flow",
  diff: "list files changed since last user message",
  compact: "force a context compaction now",
  clear: "clear and reset the working slate",
  transmissions: "open the signals log",
};

export function registerHooks(builder: Glove): void {
  builder.defineHook("compact", async ({ controls }) => {
    await controls.forceCompaction();
  });

  builder.defineHook("plan", async () => ({
    rewriteText:
      "[/plan mode] For this turn, do NOT write code. Think through the problem, " +
      "outline an approach, and ask any clarifying questions before proceeding.",
  }));

  builder.defineHook("diff", async () => ({
    rewriteText:
      "[/diff request] List the files touched since the last user message, " +
      "with a one-line summary of what changed in each.",
  }));

  builder.defineHook("clear", async ({ controls }) => {
    await controls.forceCompaction();
    return {
      shortCircuit: {
        message: {
          sender: "agent",
          text: "Session cleared.",
        },
      },
    };
  });

  // Registered for catalogue visibility only — /build is intercepted in
  // glorp.send() before processRequest, so this hook never actually fires.
  builder.defineHook("build", async () => ({
    shortCircuit: {
      message: { sender: "agent", text: "Starting orchestrated build…" },
    },
  }));

  builder.defineHook("transmissions", async () => ({
    shortCircuit: {
      message: {
          sender: "agent",
          text: "The signals log contains operational notes and transmission history.",
      },
    },
  }));
}
