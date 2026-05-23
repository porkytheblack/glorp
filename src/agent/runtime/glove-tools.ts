import type { Tool, Context } from "glove-core/core";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import { createTaskTool } from "glove-core/tools/task-tool";
import { createInboxTool } from "glove-core/tools/inbox-tool";

export function foldContextTools(agent: IGloveRunnable, context: Context): void {
  agent.fold(toolToFoldArgs(createTaskTool(context)));
  agent.fold(toolToFoldArgs(createInboxTool(context)));
}

export function toolToFoldArgs<I>(tool: Tool<I>): GloveFoldArgs<I> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
    jsonSchema: tool.jsonSchema,
    requiresPermission: tool.requiresPermission,
    unAbortable: tool.unAbortable,
    do: (input, _display, _glove, signal) => tool.run(input, undefined, signal),
  };
}
