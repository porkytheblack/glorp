"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Loading, StateBadge, timeAgo } from "@/components/ui";
import type { SessionDto, NamespaceDto, WorkspaceDto, ProfileDto } from "@/lib/types";

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href} className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </Link>
  );
}

export default function HomePage() {
  const router = useRouter();
  const sessions = useQuery<{ sessions: SessionDto[]; total: number }>("/sessions");
  const namespaces = useQuery<{ namespaces: NamespaceDto[] }>("/namespaces");
  const workspaces = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const profiles = useQuery<{ profiles: ProfileDto[] }>("/models/profiles");

  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (workspace.trim()) body.workspace = workspace.trim();
      const session = await api<SessionDto>("/sessions", { method: "POST", body });
      await api(`/sessions/${session.id}/messages`, { method: "POST", body: { text: prompt.trim() } });
      router.push(`/sessions/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to launch");
      setBusy(false);
    }
  };

  const recent = (sessions.data?.sessions ?? []).slice(0, 5);

  return (
    <div>
      <div style={{ textAlign: "center", margin: "20px 0 26px" }}>
        <h2 style={{ fontSize: 26, margin: 0, letterSpacing: "-0.4px" }}>What should the fleet build today?</h2>
        <p className="muted" style={{ marginTop: 6 }}>Launch a new agent session, or jump back into a running one.</p>
      </div>

      <div className="card" style={{ maxWidth: 760, margin: "0 auto 30px", padding: 16 }}>
        <textarea
          className="textarea"
          placeholder="Describe a task — e.g. “add rate limiting to the API routes”"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ border: "none", background: "transparent", minHeight: 70, padding: 6 }}
        />
        <div className="row spread mt-1" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <input
            className="input"
            style={{ maxWidth: 360 }}
            placeholder="workspace path (optional)"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          />
          <button className="btn primary" onClick={launch} disabled={busy || !prompt.trim()}>
            {busy ? <span className="spinner" /> : "Launch ▸"}
          </button>
        </div>
        {error && <div className="badge red dot mt-2">{error}</div>}
      </div>

      <div className="grid cols-4 mt-2">
        <Stat label="Sessions" value={sessions.data?.total ?? "—"} href="/sessions" />
        <Stat label="Namespaces" value={namespaces.data?.namespaces.length ?? "—"} href="/namespaces" />
        <Stat label="Workspaces" value={workspaces.data?.workspaces.length ?? "—"} href="/workspaces" />
        <Stat label="Model profiles" value={profiles.data?.profiles.length ?? "—"} href="/credentials" />
      </div>

      <h3 className="mt-3" style={{ fontSize: 15 }}>Recent sessions</h3>
      <div className="card" style={{ padding: 0 }}>
        {sessions.loading ? (
          <Loading />
        ) : recent.length === 0 ? (
          <div className="empty"><div className="ico">▤</div>No sessions yet.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Title</th><th>State</th><th>Workspace</th><th>Activity</th></tr></thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/sessions/${s.id}`)}>
                  <td>{s.title ?? <span className="faint">untitled</span>}</td>
                  <td><StateBadge state={s.state} /></td>
                  <td className="mono">{s.workspace}</td>
                  <td className="muted">{timeAgo(s.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
