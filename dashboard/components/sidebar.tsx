"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

interface NavLink { href: string; label: string; icon: string; }

const PRIMARY: NavLink[] = [
  { href: "/", label: "Home", icon: "◆" },
  { href: "/sessions", label: "Sessions", icon: "▤" },
  { href: "/agents", label: "Agents", icon: "✦" },
  { href: "/messages", label: "Messages", icon: "✉" },
];

const RESOURCES: NavLink[] = [
  { href: "/namespaces", label: "Namespaces", icon: "▢" },
  { href: "/workspaces", label: "Workspaces", icon: "▦" },
  { href: "/provisioning", label: "Provisioning", icon: "⚙" },
];

const ACCESS: NavLink[] = [
  { href: "/credentials", label: "Credentials", icon: "⚿" },
  { href: "/keys", label: "API Keys", icon: "⚷" },
];

function Item({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link href={link.href} className={`nav-item${active ? " active" : ""}`}>
      <span className="ico">{link.icon}</span>
      {link.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { identity, logout } = useAuth();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">G</span> Garage
      </div>
      <nav className="sidebar-nav">
        {PRIMARY.map((l) => <Item key={l.href} link={l} active={isActive(l.href)} />)}
        <div className="sidebar-section">Resources</div>
        {RESOURCES.map((l) => <Item key={l.href} link={l} active={isActive(l.href)} />)}
        <div className="sidebar-section">Access</div>
        {ACCESS.map((l) => <Item key={l.href} link={l} active={isActive(l.href)} />)}
      </nav>
      <div className="sidebar-foot">
        <span className="avatar">{(identity?.user ?? "?").slice(0, 1).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "var(--text)" }}>{identity?.user ?? "admin"}</div>
          <div className="faint" style={{ fontSize: 11 }}>{identity?.is_admin ? "administrator" : "member"}</div>
        </div>
        <button className="btn ghost sm" onClick={logout} title="Sign out">⇥</button>
      </div>
    </aside>
  );
}
