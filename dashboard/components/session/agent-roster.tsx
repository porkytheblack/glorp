"use client";

import * as React from "react";
import { Bot, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ConfirmButton } from "@/components/shared";
import type { AgentInfo } from "@/lib/types";

/** Inline composer to enlist a specialist — shared by the collapsed + full views. */
function AddSpecialist({ onAdd }: { onAdd: (role: string) => void }) {
  const [role, setRole] = React.useState("");
  const add = () => {
    if (!role.trim()) return;
    onAdd(role.trim());
    setRole("");
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        value={role}
        onChange={(e) => setRole(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="Add a specialist…"
        className="h-8 flex-1 text-[12.5px]"
      />
      <Button variant="secondary" size="sm" onClick={add} disabled={!role.trim()} className="shrink-0">
        <Plus /> Add
      </Button>
    </div>
  );
}

/** Avatar + name + role/turns + active/working badges. */
function AgentRow({ a, active, onSwitch, onRemove }: { a: AgentInfo; active: boolean; onSwitch: () => void; onRemove: () => void }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-3 py-2.5", active && "bg-surface-2/60")}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-faint shadow-sheen">
        <Bot className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-foreground">{a.label}</span>
          {active && <Badge variant="brand">active</Badge>}
          {a.busy && <Badge variant="warning">working</Badge>}
        </div>
        <div className="truncate text-[11.5px] text-faint">
          {a.role} · {a.turnCount} turn{a.turnCount === 1 ? "" : "s"}
        </div>
      </div>
      {!active && (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={onSwitch}>
            Make active
          </Button>
          <ConfirmButton label="Remove" onConfirm={onRemove} />
        </div>
      )}
    </div>
  );
}

/** The multi-agent roster for a session — add specialists, switch, retire.
 *  A lone default agent collapses to one quiet row + a "+ Add specialist"
 *  reveal; the full roster emerges with 2+ agents or once the user opts in. */
export function AgentRoster({
  agents,
  activeId,
  onSwitch,
  onAdd,
  onRemove,
}: {
  agents: AgentInfo[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onAdd: (role: string) => void;
  onRemove: (id: string) => void;
}) {
  const [opened, setOpened] = React.useState(false);

  if (agents.length === 0) {
    return <EmptyState icon={Bot} title="No agents yet" description="A session starts with a single agent; add specialists to delegate work." className="py-8" />;
  }

  // Lone agent: stay compact until the user reaches for a specialist.
  if (agents.length === 1 && !opened) {
    const a = agents[0];
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative grid size-2 shrink-0 place-items-center">
            <span className="absolute size-2 rounded-full bg-success opacity-60 animate-pulse-ring" />
            <span className="relative size-2 rounded-full bg-success" />
          </span>
          <span className="truncate text-[12.5px] font-medium text-foreground">{a.label}</span>
        </div>
        <button
          type="button"
          onClick={() => setOpened(true)}
          className="shrink-0 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          + Add specialist
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="surface divide-y divide-border/60 overflow-hidden">
        {agents.map((a) => (
          <AgentRow key={a.id} a={a} active={a.id === activeId} onSwitch={() => onSwitch(a.id)} onRemove={() => onRemove(a.id)} />
        ))}
      </div>
      <AddSpecialist onAdd={onAdd} />
    </div>
  );
}
