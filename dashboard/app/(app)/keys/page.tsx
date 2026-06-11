"use client";

import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Page, PageHeader, Loading, EmptyState, ErrorState, ConfirmButton, SecretReveal, Spinner } from "@/components/shared";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { ApiKeyPublic } from "@/lib/types";

/** One key, dense but legible — name + prefix, scopes, and quiet timestamps. */
function KeyRow({ k, onRevoke }: { k: ApiKeyPublic; onRevoke: () => void }) {
  return (
    <div className={cn("flex items-center gap-3 px-3.5 py-2.5", k.revoked && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-[13.5px] font-medium text-foreground", k.revoked && "line-through")}>{k.name}</span>
          {k.revoked && <Badge variant="destructive">revoked</Badge>}
        </div>
        <div className="truncate font-mono text-[12px] text-faint">{k.keyPrefix}…</div>
      </div>
      <div className="hidden flex-wrap gap-1 sm:flex">
        {k.scopes.map((s) => (
          <Badge key={s} variant="outline">
            {s}
          </Badge>
        ))}
      </div>
      <div className="hidden w-20 shrink-0 text-right sm:block">
        <div className="tnum text-[12px] text-muted-foreground">{timeAgo(k.createdAt)}</div>
        <div className="text-[11px] text-faint">created</div>
      </div>
      <div className="w-20 shrink-0 text-right">
        <div className="tnum text-[12px] text-muted-foreground">{timeAgo(k.lastUsed)}</div>
        <div className="text-[11px] text-faint">last used</div>
      </div>
      <div className="flex w-[88px] shrink-0 justify-end">{!k.revoked && <ConfirmButton label="Revoke" onConfirm={onRevoke} />}</div>
    </div>
  );
}

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

      <div className="surface overflow-hidden">
        {loading ? (
          <Loading />
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys" description="Mint one for a client or the MCP server." />
        ) : (
          <div className="divide-y divide-border/60">
            {keys.map((k) => (
              <KeyRow key={k.id} k={k} onRevoke={() => revoke(k.id)} />
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
