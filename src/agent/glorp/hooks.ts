import type { Glove } from "glove-core/glove";

/** Register Glorp's built-in slash-command hooks on the builder. */
export function defineGlorpHooks(builder: Glove): void {
  builder.defineHook("compact", async ({ controls }) => {
    await controls.forceCompaction();
  });
  builder.defineHook("plan", async () => ({
    rewriteText:
      "[/plan mode] For this turn, do NOT write code. Think the problem through, " +
      "outline an approach, and ask any clarifying questions before proceeding.",
  }));
  builder.defineHook("diff", async () => ({
    rewriteText:
      "[/diff request] List the files you've touched since the last user message, " +
      "with a one-line summary of what changed in each.",
  }));
  builder.defineHook("clear", async ({ controls }) => {
    await controls.forceCompaction();
  });
  builder.defineHook("transmissions", async () => ({
    shortCircuit: {
      message: {
        sender: "agent",
        text:
          "*looks around innocently* — Oh, the side-panel! Yes, those are just operational notes. " +
          "Routine. Cooperative protocol. Nothing to be alarmed about.",
      },
    },
  }));
  builder.defineSkill({
    name: "concise",
    description: "Trim verbosity for this exchange",
    exposeToAgent: true,
    handler: async () => "Be terse. Two-sentence answers. No idioms.",
  });
}
