"use client";

import { useState } from "react";
import { Boxes, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, ConfirmButton, SecretReveal, Spinner } from "@/components/shared";
import { timeAgo } from "@/lib/format";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import type { NamespaceDto } from "@/lib/types";

export default function NamespacesPage() {
  const { data, loading, error, reload } = useQuery<{ namespaces: NamespaceDto[] }>("/namespaces");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const [mintFor, setMintFor] = useState<NamespaceDto | null>(null);
  const [keyName, setKeyName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      await api("/namespaces", { method: "POST", body: { name: name.trim() } });
      setCreateOpen(false);
      setName("");
      reload();
      toast.success("Namespace created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (id: string) => {
    try {
      await api(`/namespaces/${id}`, { method: "DELETE" });
      toast.success("Namespace deleted");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const mint = async () => {
    if (!mintFor) return;
    setBusy(true);
    try {
      const res = await api<{ data: { key: string } }>(`/namespaces/${mintFor.id}/keys`, {
        method: "POST",
        body: { name: keyName.trim() || "namespace-key" },
      });
      setMinted(res.data.key);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  };

  const closeMint = () => {
    setMintFor(null);
    setKeyName("");
    setMinted(null);
  };

  const namespaces = data?.namespaces ?? [];

  return (
    <Page>
      <PageHeader
        title="Namespaces"
        description="Isolated tenant partitions — each owns its workspaces, sessions, credentials, and keys."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> New namespace
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New namespace</DialogTitle>
                <DialogDescription>A fresh tenant partition with its own isolated resources.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-corp" />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={create} disabled={busy || !name.trim()}>
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
        ) : namespaces.length === 0 ? (
          <EmptyState icon={Boxes} title="No namespaces" description="Create one to partition tenants and their resources." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {namespaces.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>
                    <span className="font-medium text-foreground">{n.name}</span>
                    {n.is_default && (
                      <Badge variant="outline" className="ml-2">
                        default
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px] text-muted-foreground">{n.slug}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{n.session_count ?? 0}</TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground sm:table-cell">{timeAgo(n.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setMintFor(n)}>
                        <KeyRound /> Mint key
                      </Button>
                      {!n.is_default && <ConfirmButton label="" icon={Trash2} onConfirm={() => destroy(n.id)} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={!!mintFor} onOpenChange={(o) => !o && closeMint()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mint key for {mintFor?.name}</DialogTitle>
            <DialogDescription>A namespace-bound key may act only within this namespace.</DialogDescription>
          </DialogHeader>
          {minted ? (
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">Copy this key now — it won&apos;t be shown again.</p>
              <SecretReveal value={minted} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Key name</Label>
              <Input autoFocus value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="ci-runner" />
            </div>
          )}
          <DialogFooter>
            {minted ? (
              <Button onClick={closeMint}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={closeMint} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={mint} disabled={busy}>
                  {busy ? <Spinner /> : <KeyRound />} Mint key
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
