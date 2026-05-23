import { Glove } from "glove-core/glove";
import type { ModelAdapter, StoreAdapter } from "glove-core/core";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import { MemoryStore } from "../memory-store-shim.ts";
import { registerTools } from "../tools/registry.ts";
import { loadPrompt } from "../prompts.ts";
import type { BuildSubAgentArgs, SubAgentFactoryResult } from "./types.ts";

/**
 * Generic builder for a subagent based on a `SubAgentDef`. The catalog uses
 * this for every registered agent so each agent file only declares its
 * metadata; the factory wiring lives here.
 */
export function buildSubAgent(args: BuildSubAgentArgs): SubAgentFactoryResult {
  const { def, workspace, dataDir } = args;
  return {
    name: def.name,
    description: def.description,
    factory: async ({ parentStore, parentControls }: {
      parentStore: StoreAdapter;
      parentControls: { glove: { model: ModelAdapter }; displayManager: DisplayManagerAdapter };
    }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.(def.name, false)) ??
        new MemoryStore(`${def.name}_${Date.now()}`);
      const child = new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt: loadPrompt(def.promptName),
        compaction_config: {
          compaction_instructions:
            def.compactionInstruction ?? "Summarise progress on the task; drop chatter.",
          max_turns: def.maxTurns ?? 12,
        },
        enableToolResultSummary: true,
      });
      registerTools(child, def.tools, { workspace, dataDir });
      return child.build();
    },
  };
}
