"use client";

/**
 * Admin auth context. Holds the JWT + identity, exposes login/logout, and
 * gates the dashboard: unauthenticated users are routed to /login.
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api, setToken, getToken } from "./api";
import type { Identity } from "./types";

interface AuthState {
  identity: Identity | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setIdentity(null);
      setReady(true);
      return;
    }
    try {
      const me = await api<Identity>("/auth/me");
      setIdentity(me.authenticated ? me : null);
    } catch {
      setIdentity(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Redirect rules once we know the auth state.
  useEffect(() => {
    if (!ready) return;
    const onLogin = pathname === "/login";
    if (!identity && !onLogin) router.replace("/login");
    if (identity && onLogin) router.replace("/");
  }, [ready, identity, pathname, router]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<{ token: string }>("/auth/login", {
      method: "POST",
      body: { username, password },
      auth: false,
    });
    setToken(res.token);
    await refresh();
    router.replace("/");
  }, [refresh, router]);

  const logout = useCallback(() => {
    setToken(null);
    setIdentity(null);
    router.replace("/login");
  }, [router]);

  return <Ctx.Provider value={{ identity, ready, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
