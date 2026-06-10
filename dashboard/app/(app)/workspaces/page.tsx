"use client";

import { useState } from "react";
import { FolderGit2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { WorkspaceRow } from "./list";
import type { WorkspaceDto } from "@/lib/types";

export default function WorkspacesPage() {
  const { data, loading, error, reload } = useQuery<{ workspaces: WorkspaceDto[] }>("/workspaces");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (name.trim()) body.name = name.trim();
      if (path.trim()) body.path = path.trim();
      await api("/workspaces", { method: "POST", body });
      setOpen(false);
      setName("");
      setPath("");
      reload();
      toast.success("Workspace created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (id: string) => {
    try {
      await api(`/workspaces/${id}`, { method: "DELETE" });
      toast.success("Workspace deleted");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const workspaces = data?.workspaces ?? [];

  return (
    <Page>
      <PageHeader
        title="Workspaces"
        description="Named directories on the Garage host that sessions run against — the sandbox each agent works in."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> New workspace
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New workspace</DialogTitle>
                <DialogDescription>Leave the path blank to create one under the Garage workspace root.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" />
                </div>
                <div className="space-y-1.5">
                  <Label>Path (optional)</Label>
                  <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/dev/my-app" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={create} disabled={busy}>
                  {busy ? <Spinner /> : null} Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {error && <ErrorState message={error} className="mb-4" />}

      <div className="surface overflow-hidden">
        {loading ? (
          <Loading />
        ) : workspaces.length === 0 ? (
          <EmptyState icon={FolderGit2} title="No workspaces" description="Create one, or let sessions create them on demand." />
        ) : (
          <div className="divide-y divide-border/60">
            {workspaces.map((w) => (
              <WorkspaceRow key={w.id} w={w} onDelete={destroy} />
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
