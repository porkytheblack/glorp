"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Boxes, ChevronRight, Cpu, FolderGit2, SendHorizontal } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { launchSession } from "@/lib/launch";
import { baseName, timeAgo } from "@/lib/format";
import { Loading, EmptyState, SessionStatus, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import type { SessionDto, WorkspaceDto, ProfileDto, NamespaceDto } from "@/lib/types";

const DEFAULT_WS = "__default__";
const DEFAULT_MODEL = "__default__";

export default function OverviewPage() {
  const router = useRouter();
  const sessions = useQuery<{ sessions: SessionDto[]; total: number }>("/sessions");
  const workspaces = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const profiles = useQuery<{ profiles: ProfileDto[] }>("/models/profiles");
  const namespaces = useQuery<{ namespaces: NamespaceDto[] }>("/namespaces");

  const [prompt, setPrompt] = useState("");
  const [ws, setWs] = useState(DEFAULT_WS);
  const [profile, setProfile] = useState(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);

  const wsList = workspaces.data?.workspaces ?? [];
  const profileList = profiles.data?.profiles ?? [];
  const recent = [...(sessions.data?.sessions ?? [])]
    .sort((a, b) => b.last_activity.localeCompare(a.last_activity))
    .slice(0, 6);

  const launch = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const id = await launchSession({
        prompt,
        workspaceId: ws === DEFAULT_WS ? undefined : ws,
        profileId: profile === DEFAULT_MODEL ? undefined : profile,
      });
      router.push(`/sessions/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the session");
      setBusy(false);
    }
  };

  const chips = [
    { href: "/namespaces", icon: Boxes, label: "namespaces", n: namespaces.data?.namespaces.length },
    { href: "/workspaces", icon: FolderGit2, label: "workspaces", n: wsList.length },
    { href: "/credentials", icon: Cpu, label: "models", n: profileList.length },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-12 md:px-8">
        <h2 className="text-center text-2xl font-semibold tracking-tight">What should Glorp build?</h2>
        <p className="mt-2 text-center text-[13.5px] text-muted-foreground">Describe a task to launch an agent, or jump back into a running session.</p>

        <div className="mt-7 rounded-xl border border-border bg-card p-3 shadow-sm focus-within:border-ring/40">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) launch();
            }}
            placeholder="e.g. Add rate limiting to the API routes and write a test for it."
            className="min-h-[84px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Select value={ws} onValueChange={setWs}>
                <SelectTrigger className="h-8 w-[170px] text-[13px]">
                  <FolderGit2 className="size-3.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_WS}>Default workspace</SelectItem>
                  {wsList.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger className="h-8 w-[160px] text-[13px]">
                  <Cpu className="size-3.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
                  {profileList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={launch} disabled={busy || !prompt.trim()}>
              {busy ? <Spinner /> : <SendHorizontal />} Launch
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
          {chips.map((c) => (
            <Link key={c.href} href={c.href} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 transition-colors hover:bg-secondary hover:text-foreground">
              <c.icon className="size-3.5" />
              {c.n ?? "—"} {c.label}
            </Link>
          ))}
        </div>

        <div className="mt-10">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-muted-foreground">Recent sessions</h3>
            <Link href="/sessions" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
              All sessions <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {sessions.loading ? (
              <Loading />
            ) : recent.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No sessions yet" description="Launch one above to put an agent to work." />
            ) : (
              <div className="divide-y divide-border">
                {recent.map((s) => (
                  <Link key={s.id} href={`/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/40">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] text-foreground">{s.title ?? "Untitled session"}</div>
                      <div className="truncate text-[12px] text-muted-foreground">{baseName(s.workspace)}</div>
                    </div>
                    <SessionStatus state={s.state} className="hidden sm:inline-flex" />
                    <span className="w-12 shrink-0 text-right text-[12px] text-muted-foreground">{timeAgo(s.last_activity)}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
