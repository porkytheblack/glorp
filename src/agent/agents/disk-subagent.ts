import { Glove } from "glove-core/glove";
import type { DefineSubAgentArgs } from "glove-core/extensions";
import type { ModelAdapter, StoreAdapter } from "glove-core/core";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import { routingLine } from "../extensions-loader.ts";
import type { LoadedSubagent } from "../extensions-loader.ts";
import { GlorpStore } from "../store.ts";
import { createToolRegistry, READ_ONLY_TOOLS, registerTools } from "../tools/registry.ts";
import * as os from "node:os";
import * as path from "node:path";

interface DiskSubAgentDeps {
  workspace: string;
  dataDir?: string;
}

interface ParentControls {
  glove: { model: ModelAdapter };
  displayManager: DisplayManagerAdapter;
}

const SUBAGENT_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "apply_patch",
  "bash",
  "glob",
  "grep",
  "ls",
  "web_fetch",
] as const;

const SUBAGENT_TOOL_SET = new Set<string>(SUBAGENT_TOOL_NAMES);

export function makeDiskSubAgent(
  sub: LoadedSubagent,
  deps: DiskSubAgentDeps,
): DefineSubAgentArgs {
  const requested = sub.toolAllowlist?.length
    ? sub.toolAllowlist.filter((name) => SUBAGENT_TOOL_SET.has(name))
    : READ_ONLY_TOOLS;

  return {
    name: sub.name,
    // Routing one-liner: the dispatch tool embeds every subagent's entry in
    // its description, so multi-KB frontmatter descriptions ride on EVERY
    // model request otherwise. The full text stays on sub.systemPrompt.
    description: routingLine(sub.description),
    factory: async ({ parentStore, parentControls }: {
      parentStore: StoreAdapter;
      parentControls: ParentControls;
    }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.(sub.name, false)) ??
        new GlorpStore(
          `${sub.name}_${Date.now()}`,
          deps.dataDir ?? path.join(os.tmpdir(), "glorp-subagents"),
        );
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
      });
      registerTools(child, createToolRegistry(deps), requested);
      return child.build();
    },
  };
}
