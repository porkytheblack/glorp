/** Token-usage + cost read endpoints: per-session and namespace-wide rollup. */

import type { SessionManager } from "../manager.ts";
import { json, errorJson } from "../respond.ts";
import { totalsToDto, modelUsageToDto, byCostDesc } from "../usage-dto.ts";
import type { NamespaceUsageDto, SessionUsageDto } from "../types.ts";

export interface UsageRoutes {
  /** GET /usage — namespace-wide spend rollup (totals + per-model/workspace/session). */
  namespace(): Promise<Response>;
  /** GET /sessions/:id/usage — one session's per-model breakdown. */
  session(id: string): Promise<Response>;
}

export function usageRoutes(manager: SessionManager, nsId: string): UsageRoutes {
  return {
    async namespace(): Promise<Response> {
      const r = await manager.usageRollup();
      const dto: NamespaceUsageDto = {
        namespace: nsId,
        totals: totalsToDto(r.totals),
        by_model: r.byModel.map(modelUsageToDto).sort(byCostDesc),
        by_workspace: r.byWorkspace
          .map((w) => ({ workspace_id: w.workspaceId, name: w.name, totals: totalsToDto(w.totals) }))
          .sort((a, b) => b.totals.cost_usd - a.totals.cost_usd),
        by_session: r.bySession
          .map((s) => ({
            session_id: s.sessionId,
            title: s.title,
            workspace_id: s.workspaceId,
            model_label: s.modelLabel,
            totals: totalsToDto(s.totals),
          }))
          .sort((a, b) => b.totals.cost_usd - a.totals.cost_usd),
      };
      return json(dto);
    },

    async session(id): Promise<Response> {
      const u = await manager.sessionUsage(id);
      if (!u) return errorJson("not_found", `Session ${id} not found`, 404);
      const dto: SessionUsageDto = {
        session_id: id,
        totals: totalsToDto(u.totals),
        models: u.usage.map(modelUsageToDto).sort(byCostDesc),
      };
      return json(dto);
    },
  };
}
