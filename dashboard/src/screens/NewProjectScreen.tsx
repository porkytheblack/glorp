/**
 * Full-screen "new project / workspace": point Glorp at a host folder (absolute
 * path) with an optional display name → `api.createWorkspace`. On success the
 * shell chains into the new-chat screen with this workspace preselected.
 */

import { useState } from "react";
import { FolderGit2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { api } from "../api/client.ts";

export interface NewProjectScreenProps {
  onCreated: (workspaceId: string) => void;
  onCancel: () => void;
}

export function NewProjectScreen(p: NewProjectScreenProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!path.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const ws = await api.createWorkspace(path.trim(), name.trim() || undefined);
      p.onCreated(ws.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-md space-y-5">
        <div className="space-y-2 text-center">
          <FolderGit2 size={26} className="mx-auto text-glorp-accent" strokeWidth={1.75} />
          <h1 className="text-[22px] font-medium tracking-tight text-glorp-text">Add a workspace</h1>
          <p className="text-[13px] text-glorp-muted">
            Point Glorp at a folder on the host. Chats you start here run against that directory.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ws-path">Folder path</Label>
            <Input
              id="ws-path"
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && path.trim()) void submit();
                if (e.key === "Escape") p.onCancel();
              }}
              placeholder="/abs/path/on/host"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Name (optional)</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to the folder name"
            />
          </div>

          {error && <p className="text-[13px] text-glorp-error">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={p.onCancel}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!path.trim() || pending}>
              {pending && <Loader2 size={14} className="animate-spin" />}
              Create workspace
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
