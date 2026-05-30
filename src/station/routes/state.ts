/** Read-only session state queries: history, plan, tasks, permissions. */

import type { SessionManager } from "../manager.ts";
import { turnsFromMessages } from "../../agent/runtime/hydrate.ts";
import { json, errorJson, noContent } from "../respond.ts";

export interface StateRoutes {
  history(id: string): Promise<Response>;
  plan(id: string): Promise<Response>;
  tasks(id: string): Promise<Response>;
  permissions(id: string): Promise<Response>;
  revokePermission(id: string, key: string): Promise<Response>;
}

export function stateRoutes(manager: SessionManager): StateRoutes {
  function require(id: string) {
    return manager.getOrRehydrate(id);
  }

  return {
    async history(id): Promise<Response> {
      const session = require(id);
      if (!session) return notFound(id);
      const messages = await session.peekStore().getDisplayMessages();
      return json({ turns: turnsFromMessages(messages) });
    },

    async plan(id): Promise<Response> {
      const session = require(id);
      if (!session) return notFound(id);
      return json({ plan: await session.peekStore().getPlan() });
    },

    async tasks(id): Promise<Response> {
      const session = require(id);
      if (!session) return notFound(id);
      const tasks = await session.peekStore().getTasks();
      return json({
        tasks: tasks.map((t) => ({
          id: t.id,
          content: t.content,
          activeForm: t.activeForm,
          status: t.status,
        })),
      });
    },

    async permissions(id): Promise<Response> {
      const session = require(id);
      if (!session) return notFound(id);
      return json({ permissions: session.peekStore().listPermissions() });
    },

    async revokePermission(id, key): Promise<Response> {
      const session = require(id);
      if (!session) return notFound(id);
      const decoded = decodeURIComponent(key);
      const handle = session.current();
      if (handle) await handle.clearPermissionKey(decoded);
      else await session.peekStore().clearPermissionKey(decoded);
      return noContent();
    },
  };
}

function notFound(id: string): Response {
  return errorJson("not_found", `Session ${id} not found`, 404);
}
