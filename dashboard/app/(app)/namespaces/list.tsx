"use client";

import { KeyRound, Layers, Trash2 } from "lucide-react";
import { timeAgo, usd } from "@/lib/format";
import { ConfirmButton } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { NamespaceDto } from "@/lib/types";

/** A single tenant partition: identity (name + slug) on the left, weight + actions trailing. */
export function NamespaceRow({
  n,
  onMint,
  onDelete,
}: {
  n: NamespaceDto;
  onMint: (n: NamespaceDto) => void;
  onDelete: (id: string) => void;
}) {
  const count = n.session_count ?? 0;
  return (
    <div className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2">
      <Layers className="size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-foreground">{n.name}</span>
          {n.is_default && (
            <Badge variant="outline" className="shrink-0">
              default
            </Badge>
          )}
        </div>
        <div className="truncate font-mono text-[12px] text-faint">{n.slug}</div>
      </div>
      <span className="tnum hidden w-20 shrink-0 text-right text-[12px] text-muted-foreground sm:block">
        {count} {count === 1 ? "session" : "sessions"}
      </span>
      <span className="tnum hidden w-16 shrink-0 text-right text-[12px] text-brand sm:block" title={n.cost_known ? "catalog list price" : "no catalog price — token count only"}>{usd(n.cost_usd, n.cost_known)}</span>
      <span className="tnum hidden w-12 shrink-0 text-right text-[12px] text-faint md:block">{timeAgo(n.created_at)}</span>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onMint(n)}>
          <KeyRound /> Mint key
        </Button>
        {!n.is_default && <ConfirmButton label="" icon={Trash2} onConfirm={() => onDelete(n.id)} />}
      </div>
    </div>
  );
}
