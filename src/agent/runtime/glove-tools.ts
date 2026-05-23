import type { Tool, Context } from "glove-core/core";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import { createTaskTool } from "glove-core/tools/task-tool";
import { createInboxTool } from "glove-core/tools/inbox-tool";
import { inboxManageTool } from "../tools/inbox-manage.ts";

const TASK_UPDATE_CONTINUATION_NOTE =
  "Task updates are bookkeeping only: if any task is still pending or in_progress, continue immediately with the next concrete tool call.";

export function foldContextTools(agent: IGloveRunnable, context: Context): void {
  const taskTool = toolToFoldArgs(createTaskTool(context));
  agent.fold({
    ...taskTool,
    description: `${taskTool.description}\n\nImportant: ${TASK_UPDATE_CONTINUATION_NOTE}`,
    async do(input, display, glove, signal) {
      const result = await taskTool.do(input, display, glove, signal);
      if (result.status === "success" && hasOpenTasks(result.data)) {
        return {
          ...result,
          data: { ...(result.data as object), continuation_instruction: TASK_UPDATE_CONTINUATION_NOTE },
        };
      }
      return result;
    },
  });
  agent.fold(toolToFoldArgs(createInboxTool(context)));
  agent.fold(inboxManageTool(context));
}

function hasOpenTasks(data: unknown): boolean {
  const tasks = (data as { tasks?: unknown } | undefined)?.tasks;
  return Array.isArray(tasks) && tasks.some((task) =>
    !!task && typeof task === "object" && (task as { status?: unknown }).status !== "completed"
  );
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
