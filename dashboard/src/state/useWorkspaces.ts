/**
 * Workspace-aware data layer for the sidebar: fetches `/workspaces` + `/sessions`,
 * groups sessions under their workspace, and exposes add/remove/refresh. Polls so
 * new/idle/busy state stays current.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.ts";
import type { SessionDto, WorkspaceDto } from "../types.ts";

export interface WorkspaceGroup {
  workspace: WorkspaceDto;
  sessions: SessionDto[];
}

export interface WorkspacesController {
  groups: WorkspaceGroup[];
  /** Sessions with no first-class workspace (legacy). */
  ungrouped: SessionDto[];
  sessionsById: Map<string, SessionDto>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  addWorkspace: (path: string, name?: string) => Promise<WorkspaceDto>;
  removeWorkspace: (id: string, cascade?: boolean) => Promise<void>;
}

export function useWorkspaces(pollMs = 4000): WorkspacesController {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ws, ss] = await Promise.all([api.listWorkspaces(), api.listSessions()]);
      setWorkspaces(ws.workspaces);
      setSessions(ss.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const { groups, ungrouped, sessionsById } = useMemo(() => {
    const byWs = new Map<string, SessionDto[]>();
    const loose: SessionDto[] = [];
    const index = new Map<string, SessionDto>();
    for (const s of sessions) {
      index.set(s.id, s);
      if (s.workspace_id) (byWs.get(s.workspace_id) ?? byWs.set(s.workspace_id, []).get(s.workspace_id)!).push(s);
      else loose.push(s);
    }
    const sortByActivity = (a: SessionDto, b: SessionDto) => b.last_activity.localeCompare(a.last_activity);
    const grouped: WorkspaceGroup[] = workspaces
      .map((workspace) => ({ workspace, sessions: (byWs.get(workspace.id) ?? []).sort(sortByActivity) }))
      .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name));
    return { groups: grouped, ungrouped: loose.sort(sortByActivity), sessionsById: index };
  }, [workspaces, sessions]);

  return {
    groups,
    ungrouped,
    sessionsById,
    loading,
    error,
    refresh: () => void refresh(),
    addWorkspace: async (path, name) => {
      const ws = await api.createWorkspace(path, name);
      await refresh();
      return ws;
    },
    removeWorkspace: async (id, cascade = false) => {
      await api.deleteWorkspace(id, cascade);
      await refresh();
    },
  };
}
