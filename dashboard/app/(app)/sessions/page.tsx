"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, SessionStatus, ConfirmButton } from "@/components/shared";
import { baseName, timeAgo } from "@/lib/format";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import type { SessionDto, WorkspaceDto, ProfileDto } from "@/lib/types";

export default function SessionsPage() {
  const router = useRouter();
  const { data, loading, error, reload } = useQuery<{ sessions: SessionDto[]; total: number }>("/sessions");
  const workspaces = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const profiles = useQuery<{ profiles: ProfileDto[] }>("/models/profiles");

  const destroy = async (id: string) => {
    try {
      await api(`/sessions/${id}`, { method: "DELETE" });
      toast.success("Session destroyed");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const sessions = [...(data?.sessions ?? [])].sort((a, b) => b.last_activity.localeCompare(a.last_activity));

  return (
    <Page>
      <PageHeader
        title="Sessions"
        description="Every agent session in this namespace — live, idle, or rehydratable from disk."
        actions={<NewSessionDialog workspaces={workspaces.data?.workspaces ?? []} profiles={profiles.data?.profiles ?? []} />}
      />

      {error && <ErrorState message={error} className="mb-4" />}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <Loading />
        ) : sessions.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No sessions yet" description="Launch one to put an agent to work — it runs in a sandboxed workspace." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Session</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Model</TableHead>
                <TableHead className="hidden sm:table-cell">Activity</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/sessions/${s.id}`)}>
                  <TableCell>
                    <div className="font-medium text-foreground">{s.title ?? "Untitled session"}</div>
                    <div className="text-[12px] text-muted-foreground">{baseName(s.workspace)}</div>
                  </TableCell>
                  <TableCell>
                    <SessionStatus state={s.state} />
                  </TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">{s.model_label ?? "Default"}</TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground sm:table-cell">{timeAgo(s.last_activity)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <ConfirmButton label="" icon={Trash2} onConfirm={() => destroy(s.id)} />
                      <ChevronRight className="size-4 text-muted-foreground/50" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Page>
  );
}
