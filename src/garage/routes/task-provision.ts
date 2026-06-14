/**
 * Provisioning for a task's worker session — the detached step that runs after
 * `POST /tasks` has already returned 202. It builds the workspace, registers the
 * session, wires the completion callback, and (for an immediate task) dispatches
 * the first turn. A `defer_start` task stops one step short: it provisions and
 * registers but withholds the prompt, leaving the task in "staged" so the caller
 * can upload input files before `POST /tasks/:id/start` runs it.
 */

import type { SessionManager } from "../manager.ts";
import type { GarageConfig } from "../config.ts";
import type { TaskStore, TaskRecord } from "../task-store.ts";
import type { CreateTaskInput } from "../contract.ts";
import { buildTaskDto } from "./task-project.ts";
import { attachTaskNotifier } from "../task-notifier.ts";

export interface ProvisionArgs {
  manager: SessionManager;
  store: TaskStore;
  config: GarageConfig;
  record: TaskRecord;
  params: Record<string, string> | undefined;
  permissionMode: CreateTaskInput["permission_mode"];
  /** The first turn to dispatch once provisioned, or undefined to withhold it
   *  (a `defer_start` task, started later via `POST /tasks/:id/start`). */
  sendPrompt: string | undefined;
}

/** Provision + register the session, then optionally run the first turn. Detached:
 *  the 202 was already sent, so failures are recorded on the task record. */
export function kickProvision(args: ProvisionArgs): void {
  const { manager, store, config, record, params, permissionMode, sendPrompt } = args;
  void (async () => {
    try {
      const session = await manager.create(
        {
          sessionId: record.id,
          template: record.type,
          params,
          permissionMode: permissionMode ?? "bypass",
        },
        { task: { type: record.type } }, // trust-gated: never from a public body
      );
      if (record.callback_url) {
        attachTaskNotifier(
          session,
          () => buildTaskDto(record, manager.getOrRehydrate(record.id), config, Date.now()),
          record.callback_url,
        );
      }
      if (sendPrompt !== undefined) await session.send(sendPrompt);
    } catch (err) {
      // create() tears the workspace down on failure, leaving nothing in the
      // session map — recording the error is the only way the task is observable.
      store.setProvisionError(record.id, err instanceof Error ? err.message : String(err));
    }
  })();
}
