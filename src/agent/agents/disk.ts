import { Glove } from "glove-core/glove";
import type { ModelAdapter, StoreAdapter } from "glove-core/core";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import { MemoryStore } from "../memory-store-shim.ts";
import { registerTools, DEFAULT_SUBAGENT_TOOLS, normaliseToolName, type ToolName } from "../tools/registry.ts";
import type { LoadedSubagent } from "../skills/loader.ts";
import type { SubAgentFactoryResult } from "./types.ts";

/**
 * Build a `SubAgentFactoryResult` from a disk-loaded subagent file. The
 * body becomes the system prompt; the front-matter `tools:` field narrows
 * the tool set (default: the read-only set, just like the built-in
 * planner).
 *
 * `description` ends up in both the autocomplete and the
 * `glove_invoke_subagent` tool listing — the loaded file's front-matter
 * description IS the prompt the parent agent sees. If the file's
 * description is too thin to be a useful tool description we still
 * pass it through verbatim so loader and agent stay consistent.
 */
export function buildDiskSubAgent(
  sub: LoadedSubagent,
  workspace: string,
  dataDir: string,
): SubAgentFactoryResult {
  const requested = pickTools(sub);
  return {
    name: sub.name,
    description: sub.description,
    factory: async ({ parentStore, parentControls }: {
      parentStore: StoreAdapter;
      parentControls: { glove: { model: ModelAdapter }; displayManager: DisplayManagerAdapter };
    }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.(sub.name, false)) ??
        new MemoryStore(`${sub.name}_${Date.now()}`);
      const child = new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt: sub.systemPrompt,
        compaction_config: {
          compaction_instructions: "Summarise progress on the assigned task; drop chatter.",
          max_turns: 12,
        },
        enableToolResultSummary: true,
      });
      registerTools(child, requested, { workspace, dataDir });
      return child.build();
    },
  };
}

function pickTools(sub: LoadedSubagent): readonly ToolName[] {
  if (!sub.toolAllowlist?.length) return DEFAULT_SUBAGENT_TOOLS;
  const out: ToolName[] = [];
  for (const raw of sub.toolAllowlist) {
    const name = normaliseToolName(raw);
    if (name && !out.includes(name)) out.push(name);
  }
  return out.length ? out : DEFAULT_SUBAGENT_TOOLS;
}
