"use client";

import * as React from "react";
import { Download, FileUp, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiBase, getNamespace, getToken } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import { compact, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilesRemote } from "./files-remote";
import type { FilesRemoteStatus } from "@/lib/types";

interface FileEntry {
  path: string;
  size: number;
  modified_at: string;
}

interface FileListResponse {
  files: FileEntry[];
  remote?: FilesRemoteStatus;
}

/** Authenticated direct-download URL (bearer rides as a query param). */
function downloadUrl(sessionId: string, rel: string): string {
  const u = new URL(`${apiBase()}/sessions/${sessionId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`);
  const token = getToken();
  if (token) u.searchParams.set("api_key", token);
  const ns = getNamespace();
  if (ns) u.searchParams.set("ns", ns);
  return u.toString();
}

/**
 * The session's file exchange — a per-session `uploads/` folder shared with
 * the agent. Drop documents in as inputs; download whatever the agent leaves
 * there as deliverables. Refreshes when a turn completes.
 */
export function FilesPanel({ sessionId, refresh }: { sessionId: string; refresh?: boolean }) {
  const files = useQuery<FileListResponse>(`/sessions/${sessionId}/files`, [refresh]);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Force a remote rehydrate, then refresh the list with the pulled files.
  const pull = async () => {
    setPulling(true);
    try {
      await api(`/sessions/${sessionId}/files?pull=1`);
      files.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pull failed");
    } finally {
      setPulling(false);
    }
  };

  const upload = async (list: Iterable<File>) => {
    const form = new FormData();
    let n = 0;
    for (const f of list) {
      form.append(`file_${n++}`, f, f.name);
    }
    if (n === 0) return;
    setBusy(true);
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers.authorization = `Bearer ${token}`;
      const ns = getNamespace();
      if (ns) headers["x-glorp-namespace"] = ns;
      const res = await fetch(`${apiBase()}/sessions/${sessionId}/files`, { method: "POST", headers, body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Upload failed (${res.status})`);
      toast.success(n === 1 ? "File uploaded" : `${n} files uploaded`);
      files.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rel: string) => {
    try {
      await api(`/sessions/${sessionId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
      files.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const list = files.data?.files ?? [];

  return (
    <div
      className={cn("border-t border-border/60 px-4 py-3 transition-colors", dragging && "bg-brand/[0.06]")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Files</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <FileUp className="size-3.5" /> Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.data?.remote && <FilesRemote remote={files.data.remote} pulling={pulling} onPull={() => void pull()} />}

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/70 px-3 py-2.5 text-[11.5px] leading-relaxed text-faint">
          <Paperclip className="mr-1 inline size-3 align-[-2px]" />
          Drop files here for the agent ("check uploads/…"), and download what it leaves behind.
        </p>
      ) : (
        <div className="space-y-0.5">
          {list.map((f) => (
            <div key={f.path} className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] text-foreground">{f.path}</div>
                <div className="text-[10.5px] text-faint">
                  <span className="tnum">{compact(f.size)}B</span> · {timeAgo(f.modified_at)}
                </div>
              </div>
              <a
                href={downloadUrl(sessionId, f.path)}
                download
                className="grid size-6 shrink-0 place-items-center rounded text-faint opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
                title="Download"
              >
                <Download className="size-3.5" />
              </a>
              <button
                type="button"
                onClick={() => void remove(f.path)}
                className="grid size-6 shrink-0 place-items-center rounded text-faint opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
