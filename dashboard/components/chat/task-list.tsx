"use client";

import { Check, Circle, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared";
import { ListChecks } from "lucide-react";
import type { TaskItem } from "@/lib/types";

function TaskRow({ task }: { task: TaskItem }) {
  const done = task.status === "completed";
  const active = task.status === "in_progress";
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0">
        {done ? (
          <Check className="size-4 text-success" />
        ) : active ? (
          <LoaderCircle className="size-4 animate-spin text-warning" />
        ) : (
          <Circle className="size-4 text-muted-foreground/50" />
        )}
      </span>
      <span className={cn("text-[13.5px] leading-snug", done ? "text-muted-foreground line-through" : active ? "text-foreground" : "text-foreground/80")}>
        {task.content}
      </span>
    </li>
  );
}

/** Renders the agent's task checklist. `compact` trims the empty state. */
export function TaskList({ tasks, compact = false }: { tasks: TaskItem[]; compact?: boolean }) {
  if (tasks.length === 0) {
    if (compact) return <p className="text-[13px] text-muted-foreground">No tasks tracked yet.</p>;
    return <EmptyState icon={ListChecks} title="No tasks yet" description="When the agent plans its work, the checklist appears here." />;
  }
  const done = tasks.filter((t) => t.status === "completed").length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12px] text-muted-foreground">
        <span>Tasks</span>
        <span>
          {done}/{tasks.length} done
        </span>
      </div>
      <ul className="divide-y divide-border/60">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </div>
  );
}
