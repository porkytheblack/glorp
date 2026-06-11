"use client";

import { KeyRound } from "lucide-react";
import { SecretReveal, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { NamespaceDto } from "@/lib/types";

/** Mints a namespace-bound key, then reveals it once. Restyled to the form idiom. */
export function MintKeyDialog({
  namespace,
  keyName,
  minted,
  busy,
  onKeyName,
  onMint,
  onClose,
}: {
  namespace: NamespaceDto | null;
  keyName: string;
  minted: string | null;
  busy: boolean;
  onKeyName: (v: string) => void;
  onMint: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!namespace} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mint key for {namespace?.name}</DialogTitle>
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
            <Input autoFocus value={keyName} onChange={(e) => onKeyName(e.target.value)} placeholder="ci-runner" />
          </div>
        )}
        <DialogFooter>
          {minted ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={onMint} disabled={busy}>
                {busy ? <Spinner /> : <KeyRound />} Mint key
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
