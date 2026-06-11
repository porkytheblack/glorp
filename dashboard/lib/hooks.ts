"use client";

/** Small data-fetching hook so pages stay declarative. Toasts use `sonner`. */

import { useState, useEffect, useCallback, useRef } from "react";
import { api, ApiError } from "./api";

export interface Query<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True only while a silent background refresh (poll/reload) is in flight. */
  refreshing: boolean;
  reload: () => void;
}

/**
 * Fetch `path` on mount and whenever a dep changes. Pass `pollMs` to keep the
 * data live: it refetches on an interval *silently* — `loading` stays false and
 * the previous data stays on screen, so polled views never flicker.
 */
export function useQuery<T>(path: string | null, deps: unknown[] = [], pollMs?: number): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    api<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        hasData.current = true;
        setError(null);
      })
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  useEffect(() => {
    if (!path || !pollMs) return;
    const t = setInterval(() => setTick((n) => n + 1), pollMs);
    return () => clearInterval(t);
  }, [path, pollMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refreshing, reload };
}
