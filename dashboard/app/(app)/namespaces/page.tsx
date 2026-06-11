"use client";

import { useState } from "react";
import { Boxes, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { NamespaceRow } from "./list";
import { MintKeyDialog } from "./mint-dialog";
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

      <div className="surface overflow-hidden">
        {loading ? (
          <Loading />
        ) : namespaces.length === 0 ? (
          <EmptyState icon={Boxes} title="No namespaces" description="Create one to partition tenants and their resources." />
        ) : (
          <div className="divide-y divide-border/60">
            {namespaces.map((n) => (
              <NamespaceRow key={n.id} n={n} onMint={setMintFor} onDelete={destroy} />
            ))}
          </div>
        )}
      </div>

      <MintKeyDialog
        namespace={mintFor}
        keyName={keyName}
        minted={minted}
        busy={busy}
        onKeyName={setKeyName}
        onMint={mint}
        onClose={closeMint}
      />
    </Page>
  );
}
