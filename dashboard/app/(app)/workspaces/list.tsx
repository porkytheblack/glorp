"use client";

import { FolderGit2, Trash2 } from "lucide-react";
import { timeAgo, usd } from "@/lib/format";
import { ConfirmButton } from "@/components/shared";
import type { WorkspaceDto } from "@/lib/types";

/** A single workspace: name + mono path, with session weight and age trailing. */
export function WorkspaceRow({ w, onDelete }: { w: WorkspaceDto; onDelete: (id: string) => void }) {
  const count = w.session_count;
  return (
    <div className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2">
      <FolderGit2 className="size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-foreground">{w.name}</div>
        <div className="truncate font-mono text-[12px] text-faint">{w.path}</div>
      </div>
      <span className="tnum hidden w-20 shrink-0 text-right text-[12px] sm:block">
        {count > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="size-1.5 rounded-full bg-success" />
            <span className="text-muted-foreground">{count} {count === 1 ? "session" : "sessions"}</span>
          </span>
        ) : (
          <span className="text-faint">no sessions</span>
        )}
      </span>
      <span className="tnum hidden w-16 shrink-0 text-right text-[12px] text-brand sm:block" title={w.cost_known ? "catalog list price" : "no catalog price — token count only"}>{usd(w.cost_usd, w.cost_known)}</span>
      <span className="tnum hidden w-12 shrink-0 text-right text-[12px] text-faint md:block">{timeAgo(w.created_at)}</span>
      <div className="flex shrink-0 justify-end">
        <ConfirmButton label="" icon={Trash2} onConfirm={() => onDelete(w.id)} />
      </div>
    </div>
  );
}
