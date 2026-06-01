/**
 * Tool: list the other agents in this session and their live processing state
 * so an agent can tell who is busy before spawning or coordinating. Reads the
 * shared mesh roster (`agents-state.json`), so it works the same for the main
 * agent and for spawned subprocess agents (which get the mesh dir via env).
 */

import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { loadAgentRecords, type AgentRecord } from "../../orchestrator/agent-state.ts";

type ListAgentsInput = Record<string, never>;

function isBusy(r: AgentRecord): boolean {
  return r.status === "running" || r.state === "thinking" || r.state === "working";
}

function effectiveState(r: AgentRecord): string {
  return r.state ?? (r.status === "running" ? "thinking" : "dead");
}

export function listAgentsTool(meshDir: string | undefined): GloveFoldArgs<ListAgentsInput> {
  return {
    name: "list_agents",
    description:
      "List the other agents in this session and their current processing state " +
      "(thinking, working, idle, done, dead) so you can tell who is busy before " +
      "spawning a new agent or handing off work. Returns nothing destructive.",
    inputSchema: z.object({}),
    async do() {
      if (!meshDir) return { status: "success", data: "No agent roster is available for this session." };
      try {
        const records = await loadAgentRecords(meshDir);
        if (records.length === 0) {
          return { status: "success", data: "No other agents have been spawned yet." };
        }
        const now = Date.now();
        const sorted = [...records].sort((a, b) => Number(isBusy(b)) - Number(isBusy(a)));
        const lines = sorted.map((r) => {
          const ago = Math.max(0, Math.round((now - (r.stateSince ?? r.spawnedAt)) / 1000));
          const reason = r.stopReason && r.state === "dead" ? ` — ${r.stopReason}` : "";
          return `- ${effectiveState(r).toUpperCase().padEnd(8)} ${r.label} (${r.role}) · ${ago}s ago${reason}`;
        });
        const busy = records.filter(isBusy).length;
        return {
          status: "success",
          data: `${records.length} agent(s) — ${busy} busy:\n${lines.join("\n")}`,
          renderData: { count: records.length, busy },
        };
      } catch (err: any) {
        return { status: "error", data: null, message: `Failed to read agent roster: ${err?.message ?? String(err)}` };
      }
    },
  };
}
