"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { Loading } from "@/components/ui";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/sessions": "Sessions",
  "/agents": "Agents",
  "/messages": "Messages",
  "/namespaces": "Namespaces",
  "/workspaces": "Workspaces",
  "/provisioning": "Provisioning",
  "/credentials": "Credentials",
  "/keys": "API Keys",
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const top = "/" + (pathname.split("/")[1] ?? "");
  return TITLES[top] ?? "Garage";
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, identity } = useAuth();
  const pathname = usePathname();

  // While auth resolves (or during the redirect to /login), show a spinner
  // rather than flashing the shell with no data.
  if (!ready || !identity) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Loading label="Connecting to Garage…" />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Topbar title={titleFor(pathname)} />
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
