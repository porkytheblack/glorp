"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleStop, FolderGit2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useSession } from "@/lib/useSession";
import { baseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SessionStatus, Loading, ErrorState } from "@/components/shared";
import { Conversation } from "@/components/chat/conversation";
import { Composer } from "@/components/chat/composer";
import { PermissionPrompt } from "@/components/chat/permission-prompt";
import { Inspector } from "@/components/session/inspector";
import { ModelSwitcher } from "@/components/session/model-switcher";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SessionDto, ProfileWire } from "@/lib/types";

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, loading, error } = useQuery<SessionDto>(`/sessions/${id}`);
  const profiles = useQuery<{ profiles: ProfileWire[] }>("/models/profiles");
  const { identity } = useAuth();
  const live = useSession(id);
  const [panel, setPanel] = useState(true);
  const [pickedModel, setPickedModel] = useState<string | null>(null);

  const title = live.title ?? session?.title ?? "Untitled session";
  // Prefer the live signal: once the socket is connected the REST snapshot's
  // lifecycle (e.g. a stale "provisioning") no longer reflects reality.
  const state = live.busy ? "busy" : live.connected ? "idle" : session?.state ?? "idle";
  const mode = live.mode ?? session?.permission_mode ?? "normal";
  const currentModel = pickedModel ?? session?.model_label ?? null;
  const permSlots = live.slots.filter((s) => s.isPermissionRequest);
  const userInitial = (identity?.user ?? "U").slice(0, 1).toUpperCase();

  const swap = (profileId: string, label: string) => {
    live.swapProfile(profileId);
    setPickedModel(label);
    toast.success(`Model set to ${label}`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-6 py-3">
        <div className="min-w-0">
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
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
            <SessionStatus state={state} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 text-[12px]", live.connected ? "text-muted-foreground" : "text-muted-foreground/50")}>
            <span className={cn("size-1.5 rounded-full", live.connected ? "bg-success" : "bg-muted-foreground/40")} />
            {live.connected ? "live" : "offline"}
          </span>
          {live.busy && (
            <Button size="sm" variant="secondary" onClick={live.abort}>
              <CircleStop /> Stop
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="hidden text-muted-foreground md:inline-flex"
            onClick={() => setPanel((p) => !p)}
            title={panel ? "Hide panel" : "Show panel"}
          >
            {panel ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </div>

      {loading && <Loading label="Loading session…" />}
      {error && (
        <div className="p-6">
          <ErrorState message={error} />
        </div>
      )}

      {session && (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <Conversation items={live.items} streaming={live.streaming} busy={live.busy} userInitial={userInitial} className="flex-1" />
            {permSlots.length > 0 && (
              <div className="px-4 md:px-6">
                <div className="w-full max-w-3xl space-y-2 pb-1">
                  {permSlots.map((s) => (
                    <PermissionPrompt key={s.slotId} slot={s} onResolve={live.resolvePermission} />
                  ))}
                </div>
              </div>
            )}
            <Composer
              busy={live.busy}
              disabled={!live.connected}
              onSend={live.send}
              onStop={live.abort}
              controls={<ModelSwitcher profiles={profiles.data?.profiles ?? []} current={currentModel} onSwap={swap} />}
            />
          </div>

          {panel && (
            <aside className="hidden w-[340px] shrink-0 flex-col border-l border-border md:flex">
              <Inspector
                session={session}
                stats={live.stats}
                tasks={live.tasks}
                agents={live.agents}
                activeAgentId={live.activeAgentId}
                mode={mode}
                onMode={live.setMode}
                onSwitchAgent={live.switchAgent}
                onAddAgent={live.addAgent}
                onRemoveAgent={live.removeAgent}
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
