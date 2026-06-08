/** Read-only session state queries: history, plan, tasks, permissions. */

import type { SessionManager } from "../manager.ts";
import { turnsFromMessages } from "../../agent/runtime/hydrate.ts";
import { json, errorJson, noContent } from "../respond.ts";

export interface StateRoutes {
  history(id: string): Promise<Response>;
  result(id: string): Promise<Response>;
  plan(id: string): Promise<Response>;
  tasks(id: string): Promise<Response>;
  permissions(id: string): Promise<Response>;
  revokePermission(id: string, key: string): Promise<Response>;
  agents(id: string): Promise<Response>;
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

    /**
     * The latest agent answer + run status — the one-call result fetch for
     * orchestration. `text` is the last agent turn's text (null until one lands).
     */
    async result(id): Promise<Response> {
      const session = require(id);
      if (!session) return notFound(id);
      const dto = session.toDto();
      const messages = await session.peekStore().getDisplayMessages();
      const turns = turnsFromMessages(messages);
      let text: string | null = null;
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i]!;
        if (t.kind === "agent" && typeof t.text === "string" && t.text.length > 0) {
          text = t.text;
          break;
        }
      }
      const lastError = session.stats.lastError;
      const lastTurnState = lastError ? "error" : dto.turn_count > 0 ? "ok" : null;
      return json({
        status: dto.state,
        busy: dto.busy,
        text,
        error: dto.error,
        last_error: lastError,
        last_turn_state: lastTurnState,
        turn_count: dto.turn_count,
      });
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

    /** The conversational-agent roster (builds the handle if needed). */
    async agents(id): Promise<Response> {
      const session = require(id);
      if (!session) return notFound(id);
      try {
        const handle = await session.ensureBuilt();
        return json({ agents: handle.listAgents(), active_agent_id: handle.activeAgentId });
      } catch (err) {
        return errorJson("agents_failed", err instanceof Error ? err.message : String(err), 502);
      }
    },
  };
}

function notFound(id: string): Response {
  return errorJson("not_found", `Session ${id} not found`, 404);
}
