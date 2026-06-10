"use client";

import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared";
import { ListChecks } from "lucide-react";
import type { TaskItem } from "@/lib/types";

/** Status glyph: pending faint circle, in_progress brand pulse, completed check. */
function Glyph({ status }: { status: TaskItem["status"] }) {
  if (status === "completed") return <Check className="size-3.5 text-success" />;
  if (status === "in_progress")
    return (
      <span className="relative grid size-3.5 place-items-center">
        <span className="absolute size-2 rounded-full bg-brand opacity-60 animate-pulse-ring" />
        <span className="relative size-2 rounded-full bg-brand" />
      </span>
    );
  return <Circle className="size-3.5 text-faint" />;
}

function TaskRow({ task }: { task: TaskItem }) {
  const done = task.status === "completed";
  const active = task.status === "in_progress";
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-px shrink-0">
        <Glyph status={task.status} />
      </span>
      <span
        className={cn(
          "text-[12.5px] leading-snug",
          done ? "text-faint line-through" : active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {task.content}
      </span>
    </li>
  );
}

/** Renders the agent's task checklist. `compact` trims the empty state. */
export function TaskList({ tasks, compact = false }: { tasks: TaskItem[]; compact?: boolean }) {
  if (tasks.length === 0) {
    if (compact) return <p className="text-[12.5px] text-faint">No tasks tracked yet.</p>;
    return <EmptyState icon={ListChecks} title="No tasks yet" description="When the agent plans its work, the checklist appears here." />;
  }
  return (
    <ul className="divide-y divide-border/60">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
    </ul>
  );
}
