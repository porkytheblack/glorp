/** Live-session control: abort the current request, resolve display slots. */

import type { SessionManager } from "../manager.ts";
import type { PermissionMode } from "../../agent/runtime/permission-mode.ts";
import { json, errorJson, readJson } from "../respond.ts";

const PERMISSION_MODES: readonly PermissionMode[] = ["normal", "auto", "bypass"];

interface SlotResolution {
  action?: "approve" | "deny" | "resolve" | "reject";
  allow?: boolean;
  value?: unknown;
  reason?: string;
}

export interface ControlRoutes {
  abort(id: string): Response;
  resolveSlot(id: string, slotId: string, req: Request): Promise<Response>;
  setPermissionMode(id: string, req: Request): Promise<Response>;
}

export function controlRoutes(manager: SessionManager): ControlRoutes {
  return {
    abort(id): Response {
      const session = manager.get(id);
      if (!session) return errorJson("not_found", `Session ${id} not found`, 404);
      // A session that isn't live in memory can't be mid-request: abort is a no-op.
      session.current()?.abort();
      return json({ aborted: true });
    },

    async resolveSlot(id, slotId, req): Promise<Response> {
      const session = manager.get(id);
      const handle = session?.current();
      if (!session || !handle) {
        return errorJson("not_active", `Session ${id} is not active`, 409);
      }
      let body: SlotResolution;
      try {
        body = await readJson<SlotResolution>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      const action = body.action ?? (body.allow === undefined ? "resolve" : body.allow ? "approve" : "deny");
      switch (action) {
        case "approve":
          handle.resolvePermission(slotId, true);
          break;
        case "deny":
          handle.resolvePermission(slotId, false);
          break;
        case "resolve":
          handle.resolveSlot(slotId, body.value);
          break;
        case "reject":
          handle.rejectSlot(slotId, body.reason);
          break;
        default:
          return errorJson("bad_request", `Unknown action: ${action}`, 400);
      }
      return json({ resolved: true, slot_id: slotId, action });
    },

    async setPermissionMode(id, req): Promise<Response> {
      const handle = manager.get(id)?.current();
      if (!handle) return errorJson("not_active", `Session ${id} is not active`, 409);
      let body: { mode?: string };
      try {
        body = await readJson<{ mode?: string }>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (!body.mode || !PERMISSION_MODES.includes(body.mode as PermissionMode)) {
        return errorJson("bad_request", `mode must be one of ${PERMISSION_MODES.join(", ")}`, 400);
      }
      handle.setPermissionMode(body.mode as PermissionMode);
      return json({ permission_mode: body.mode });
    },
  };
}
