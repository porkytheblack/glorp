"use client";

import * as React from "react";
import { Bot, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ConfirmButton } from "@/components/shared";
import type { AgentInfo } from "@/lib/types";

/** The multi-agent roster for a session — add specialists, switch, retire. */
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
  const [role, setRole] = React.useState("");
  const add = () => {
    if (!role.trim()) return;
    onAdd(role.trim());
    setRole("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a specialist — e.g. reviewer, tester"
          className="max-w-xs"
        />
        <Button variant="secondary" onClick={add} disabled={!role.trim()}>
          <Plus /> Add agent
        </Button>
      </div>

      {agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet" description="A session starts with a single agent; add specialists to delegate work." />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {agents.map((a) => {
            const active = a.id === activeId;
            return (
              <div key={a.id} className={cn("flex items-center gap-3 px-4 py-3", active && "bg-secondary/30")}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-muted-foreground">
                  <Bot className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-foreground">{a.label}</span>
                    {active && <Badge variant="brand">active</Badge>}
                    {a.busy && <Badge variant="warning">working</Badge>}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {a.role} · {a.turnCount} turn{a.turnCount === 1 ? "" : "s"}
                  </div>
                </div>
                {!active && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onSwitch(a.id)}>
                      Make active
                    </Button>
                    <ConfirmButton label="Remove" onConfirm={() => onRemove(a.id)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
