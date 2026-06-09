"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { Loading } from "@/components/shared";
import { BrandLockup } from "@/components/brand";

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/sessions": "Sessions",
  "/namespaces": "Namespaces",
  "/workspaces": "Workspaces",
  "/provisioning": "Provisioning",
  "/credentials": "Models",
  "/keys": "API Keys",
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/sessions/")) return "Session";
  const top = "/" + (pathname.split("/")[1] ?? "");
  return TITLES[top] ?? "Garage";
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, identity } = useAuth();
  const pathname = usePathname();

  // While auth resolves (or during the redirect to /login), keep it calm.
  if (!ready || !identity) {
    return (
      <div className="grid min-h-screen place-items-center gap-6">
        <div className="flex flex-col items-center gap-5">
          <BrandLockup />
          <Loading label="Connecting to Garage…" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex h-screen min-w-0 flex-1 flex-col">
        <AppTopbar title={titleFor(pathname)} />
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
