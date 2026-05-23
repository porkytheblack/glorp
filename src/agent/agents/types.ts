import type { DefineSubAgentArgs } from "glove-core/extensions";
import type { ToolName } from "../tools/registry.ts";

/**
 * A subagent definition the catalog can register. Each one ships its own
 * file under `src/agent/agents/` so its description, tool allow-list, and
 * system prompt live together.
 *
 * `description` is the text that ends up in the autocomplete menu AND in
 * the `glove_invoke_subagent` tool listing — the model uses it to decide
 * when to route to this agent, so it should be useful prose.
 */
export interface SubAgentDef {
  name: string;
  description: string;
  /** Tool names from the registry the subagent is allowed to use. */
  tools: readonly ToolName[];
  /** Name of the prompt file in `src/prompts/` to load as system prompt. */
  promptName: string;
  /** Max conversation turns before the subagent compacts. */
  maxTurns?: number;
  /** Compaction summary instruction. */
  compactionInstruction?: string;
}

export interface SubAgentDeps {
  workspace: string;
  dataDir: string;
}

export interface BuildSubAgentArgs extends SubAgentDeps {
  def: SubAgentDef;
}

export type SubAgentFactoryResult = DefineSubAgentArgs;
