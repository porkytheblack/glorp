/** Polls the session list so the sidebar reflects new/idle/busy sessions. */

import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.ts";
import type { SessionDto } from "../types.ts";

export interface SessionsController {
  sessions: SessionDto[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSessions(pollMs = 4000): SessionsController {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { sessions } = await api.listSessions();
      setSessions(sessions);
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

  return { sessions, loading, error, refresh };
}
