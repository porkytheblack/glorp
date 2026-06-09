"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  MessageSquare,
  Boxes,
  FolderGit2,
  Rocket,
  Cpu,
  KeyRound,
  LogOut,
  ChevronsUpDown,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLockup } from "@/components/brand";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const PRIMARY: NavLink[] = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/sessions", label: "Sessions", icon: MessageSquare },
];

const SETTINGS: NavLink[] = [
  { href: "/namespaces", label: "Namespaces", icon: Boxes },
  { href: "/workspaces", label: "Workspaces", icon: FolderGit2 },
  { href: "/provisioning", label: "Provisioning", icon: Rocket },
  { href: "/credentials", label: "Models", icon: Cpu },
  { href: "/keys", label: "API Keys", icon: KeyRound },
];

function NavItem({ link, active }: { link: NavLink; active: boolean }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors",
        active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand" />}
      <Icon className={cn("size-[17px] shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} />
      {link.label}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { identity, logout } = useAuth();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const user = identity?.user ?? "admin";

  return (
    <aside className="sticky top-0 flex h-screen w-[244px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center px-4">
        <BrandLockup />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {PRIMARY.map((l) => (
          <NavItem key={l.href} link={l} active={isActive(l.href)} />
        ))}
        <p className="px-2.5 pb-1 pt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Settings</p>
        {SETTINGS.map((l) => (
          <NavItem key={l.href} link={l} active={isActive(l.href)} />
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <Avatar className="size-7">
              <AvatarFallback className="text-[11px]">{user.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">{user}</div>
              <div className="truncate text-[11px] text-muted-foreground">{identity?.is_admin ? "Administrator" : "Member"}</div>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-[212px]">
            <DropdownMenuLabel>Signed in as {user}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-foreground">
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
