/**
 * Optional task completion callback. When a task is created with a
 * `callback_url`, this subscribes to its worker session's event bus and POSTs
 * the current TaskDto whenever the task transitions into a blocking/terminal
 * state — `needs_input`, `completed`, or `failed`.
 *
 * It watches `busy` (turn boundaries), `display_slot_pushed`/`_resolved` (a
 * `needs_input` transition fires while `busy` stays true), and `error`. Firing
 * is deduped per status and resets when the task goes back to `working`, so a
 * second question round notifies again. Delivery is fire-and-forget with a hard
 * timeout: a dead or slow callback host can never block the agent's turn.
 */

import type { GarageSession } from "./session.ts";
import type { TaskDto } from "./contract.ts";

const NOTIFY_STATES = new Set<TaskDto["status"]>(["needs_input", "completed", "failed"]);

export function attachTaskNotifier(
  session: GarageSession,
  buildDto: () => Promise<TaskDto>,
  url: string,
): () => void {
  let lastFired: string | null = null;
  let inFlight = false;
  let dirty = false; // a transition arrived mid-POST — re-check when it lands

  async function maybeFire(): Promise<void> {
    if (inFlight) {
      dirty = true;
      return;
    }
    let dto: TaskDto;
    try {
      dto = await buildDto();
    } catch {
      return;
    }
    if (!NOTIFY_STATES.has(dto.status)) {
      lastFired = null; // back to working/queued — let the next blocking state fire fresh
      return;
    }
    if (dto.status === lastFired) return;
    lastFired = dto.status;
    inFlight = true;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dto),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* tolerate — GitHub-style re-delivery is not our job; never throw */
    } finally {
      inFlight = false;
      if (dirty) {
        dirty = false;
        void maybeFire(); // catch a status change that happened during the POST
      }
    }
  }

  return session.bridge.subscribe((ev) => {
    if (
      ev.type === "busy" ||
      ev.type === "display_slot_pushed" ||
      ev.type === "display_slot_resolved" ||
      ev.type === "error"
    ) {
      void maybeFire();
    }
  });
}
