import type { Tool, ToolResultData } from "glove-core/core";
import type { GloveFoldArgs } from "glove-core/glove";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { IGloveRunnable } from "glove-core/glove";
import { TASK_UPDATE_NOTE } from "./types.ts";

/**
 * Convert a raw `Tool<I>` (from glove-core's factory exports — `createTaskTool`,
 * `createInboxTool`, etc.) into a `GloveFoldArgs<I>` the builder accepts.
 */
export function toolToFoldArgs<I>(tool: Tool<I>): GloveFoldArgs<I> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
    jsonSchema: tool.jsonSchema,
    requiresPermission: tool.requiresPermission,
    unAbortable: tool.unAbortable,
    do: (input: I, _display: DisplayManagerAdapter, _glove: IGloveRunnable, signal?: AbortSignal) =>
      tool.run(input, undefined, signal),
    generateToolSummary: tool.generateSummary,
  };
}

/**
 * Same as `toolToFoldArgs`, but injects the "tasks are bookkeeping" note
 * into both the description and the success payload so the agent always
 * sees the continuation instruction.
 */
export function taskToolToFoldArgs<I>(tool: Tool<I>): GloveFoldArgs<I> {
  const folded = toolToFoldArgs(tool);
  return {
    ...folded,
    description: `${tool.description}\n\nImportant: ${TASK_UPDATE_NOTE}`,
    async do(input: I, _display: DisplayManagerAdapter, _glove: IGloveRunnable, signal?: AbortSignal): Promise<ToolResultData> {
      const result = await tool.run(input, undefined, signal);
      if (result.status !== "success") return result;
      const data = result.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return { ...result, data: { ...data, _agentInstruction: TASK_UPDATE_NOTE } };
      }
      return { ...result, data: { value: data, _agentInstruction: TASK_UPDATE_NOTE } };
    },
  };
}
