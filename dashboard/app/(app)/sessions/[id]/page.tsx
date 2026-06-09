"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, CircleStop, FolderGit2, ListChecks, MessageSquare, Settings2 } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/useSession";
import { baseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SessionStatus, Loading, ErrorState } from "@/components/shared";
import { Conversation } from "@/components/chat/conversation";
import { Composer } from "@/components/chat/composer";
import { PermissionPrompt } from "@/components/chat/permission-prompt";
import { TaskList } from "@/components/chat/task-list";
import { AgentRoster } from "@/components/session/agent-roster";
import { SessionDetails } from "@/components/session/session-details";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { SessionDto } from "@/lib/types";

function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="ml-1 rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground">{n}</span>;
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, loading, error } = useQuery<SessionDto>(`/sessions/${id}`);
  const { identity } = useAuth();
  const live = useSession(id);
  const [tab, setTab] = useState("chat");

  const title = live.title ?? session?.title ?? "Untitled session";
  const state = session?.state ?? (live.busy ? "busy" : "idle");
  const mode = live.mode ?? session?.permission_mode ?? "normal";
  const permSlots = live.slots.filter((s) => s.isPermissionRequest);
  const userInitial = (identity?.user ?? "U").slice(0, 1).toUpperCase();

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-6 py-3">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Link href="/sessions" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Sessions
          </Link>
          {session?.workspace && (
            <>
              <span className="text-muted-foreground/50">/</span>
              <span className="inline-flex items-center gap-1">
                <FolderGit2 className="size-3.5" /> {baseName(session.workspace)}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
            <SessionStatus state={state} />
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("inline-flex items-center gap-1.5 text-[12px]", live.connected ? "text-muted-foreground" : "text-muted-foreground/50")}>
              <span className={cn("size-1.5 rounded-full", live.connected ? "bg-success" : "bg-muted-foreground/40")} />
              {live.connected ? "live" : "offline"}
            </span>
            {live.busy && (
              <Button size="sm" variant="secondary" onClick={live.abort}>
                <CircleStop /> Stop
              </Button>
            )}
          </div>
        </div>
      </div>

      {loading && <Loading label="Loading session…" />}
      {error && (
        <div className="p-6">
          <ErrorState message={error} />
        </div>
      )}

      {session && (
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-6">
            <TabsList>
              <TabsTrigger value="chat">
                <MessageSquare /> Chat
              </TabsTrigger>
              <TabsTrigger value="tasks">
                <ListChecks /> Tasks
                <Count n={live.tasks.length} />
              </TabsTrigger>
              <TabsTrigger value="agents">
                <Bot /> Agents
                <Count n={live.agents.length} />
              </TabsTrigger>
              <TabsTrigger value="details">
                <Settings2 /> Details
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
            <Conversation items={live.items} streaming={live.streaming} busy={live.busy} userInitial={userInitial} className="flex-1" />
            {permSlots.length > 0 && (
              <div className="px-4 md:px-6">
                <div className="mx-auto w-full max-w-3xl space-y-2 pb-1">
                  {permSlots.map((s) => (
                    <PermissionPrompt key={s.slotId} slot={s} onResolve={live.resolvePermission} />
                  ))}
                </div>
              </div>
            )}
            <Composer busy={live.busy} disabled={!live.connected} onSend={live.send} onStop={live.abort} />
          </TabsContent>

          <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-2xl">
              <TaskList tasks={live.tasks} />
            </div>
          </TabsContent>

          <TabsContent value="agents" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-2xl">
              <AgentRoster agents={live.agents} activeId={live.activeAgentId} onSwitch={live.switchAgent} onAdd={live.addAgent} onRemove={live.removeAgent} />
            </div>
          </TabsContent>

          <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <SessionDetails session={session} stats={live.stats} mode={mode} onMode={live.setMode} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
