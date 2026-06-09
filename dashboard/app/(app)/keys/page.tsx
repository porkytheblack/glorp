"use client";

import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, ConfirmButton, SecretReveal, Spinner } from "@/components/shared";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { ApiKeyPublic } from "@/lib/types";

export default function KeysPage() {
  const { data, loading, error, reload } = useQuery<{ data: ApiKeyPublic[] }>("/keys");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<{ data: { key: string } }>("/keys", { method: "POST", body: { name: name.trim() || "api-key", scopes: [scope] } });
      setMinted(res.data.key);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setName("");
    setMinted(null);
  };

  const revoke = async (id: string) => {
    try {
      await api(`/keys/${id}`, { method: "DELETE" });
      toast.success("Key revoked");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed");
    }
  };

  const keys = data?.data ?? [];

  return (
    <Page>
      <PageHeader
        title="API Keys"
        description="Keys for the REST API and the MCP server. Use one as GLORP_API_KEY, or send it as a Bearer token."
        actions={
          <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> Mint key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mint API key</DialogTitle>
                <DialogDescription>The raw key is shown once. Store it somewhere safe.</DialogDescription>
              </DialogHeader>
              {minted ? (
                <SecretReveal value={minted} />
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="mcp-server" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Scope</Label>
                    <Select value={scope} onValueChange={setScope}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin — full control</SelectItem>
                        <SelectItem value="session">session — manage sessions only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <DialogFooter>
                {minted ? (
                  <Button onClick={close}>Done</Button>
                ) : (
                  <>
                    <Button variant="ghost" onClick={close} disabled={busy}>
                      Cancel
                    </Button>
                    <Button onClick={create} disabled={busy}>
                      {busy ? <Spinner /> : <KeyRound />} Mint key
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {error && <ErrorState message={error} className="mb-4" />}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <Loading />
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys" description="Mint one for a client or the MCP server." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead className="hidden sm:table-cell">Last used</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id} className={cn(k.revoked && "opacity-50")}>
                  <TableCell className="font-medium text-foreground">
                    {k.name}
                    {k.revoked && (
                      <Badge variant="destructive" className="ml-2">
                        revoked
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px] text-muted-foreground">{k.keyPrefix}…</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="outline">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground sm:table-cell">{timeAgo(k.lastUsed)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">{!k.revoked && <ConfirmButton label="Revoke" onConfirm={() => revoke(k.id)} />}</div>
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
