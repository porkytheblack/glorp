"use client";

import { useState } from "react";
import { FolderGit2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, ConfirmButton, Spinner } from "@/components/shared";
import { timeAgo } from "@/lib/format";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
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

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <Loading />
        ) : workspaces.length === 0 ? (
          <EmptyState icon={FolderGit2} title="No workspaces" description="Create one, or let sessions create them on demand." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium text-foreground">{w.name}</TableCell>
                  <TableCell className="font-mono text-[12.5px] text-muted-foreground">{w.path}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{w.session_count}</TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground sm:table-cell">{timeAgo(w.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <ConfirmButton label="" icon={Trash2} onConfirm={() => destroy(w.id)} />
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
