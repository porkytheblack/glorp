"use client";

import * as React from "react";
import { Cloud, CloudOff, DownloadCloud } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import type { FilesRemoteStatus } from "@/lib/types";

/**
 * The quiet remote-mirror status line under the Files header: "R2 · synced 2m
 * ago", with an error rendered in destructive tone (full text in a tooltip),
 * and a Pull affordance that rehydrates remote-only files. Kept subtle — it's a
 * side channel, not the main event.
 */
export function FilesRemote({
  remote,
  pulling,
  onPull,
}: {
  remote: FilesRemoteStatus;
  pulling: boolean;
  onPull: () => void;
}) {
  if (!remote.enabled) return null;
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <Status remote={remote} />
      <button
        type="button"
        onClick={onPull}
        disabled={pulling}
        className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        title="Download remote files missing locally"
      >
        <DownloadCloud className={cn("size-3.5", pulling && "animate-pulse")} /> Pull
      </button>
    </div>
  );
}

function Status({ remote }: { remote: FilesRemoteStatus }) {
  if (remote.error) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 truncate text-[11.5px] text-destructive">
              <CloudOff className="size-3.5 shrink-0" /> Sync failed
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[280px] break-words">{remote.error}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-faint">
      <Cloud className="size-3.5 shrink-0" />
      {remote.last_sync_at ? <>R2 · synced {timeAgo(remote.last_sync_at)}</> : <>R2 · not synced yet</>}
    </span>
  );
}
