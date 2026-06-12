"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleHelp, Info, MessageSquareText, OctagonX, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DisplaySlot } from "@/lib/types";

/**
 * Interactive cards for the agent's display slots (`pushAndWait` from
 * ask_choice / ask_confirm / ask_text / show_info — renderers `select_one`,
 * `confirm`, `text_input`, `info`). The agent is BLOCKED until the slot
 * resolves, so these sit above the composer like permission prompts.
 * Unknown renderers degrade to a JSON card with a free-form answer so a new
 * agent-side modal never strands the web console.
 */
export function SlotPrompt({
  slot,
  onResolve,
  onReject,
}: {
  slot: DisplaySlot;
  onResolve: (slotId: string, value: unknown) => void;
  onReject: (slotId: string, reason?: string) => void;
}) {
  const input = (slot.input ?? {}) as Record<string, unknown>;
  switch (slot.renderer) {
    case "select_one":
      return <SelectOne slot={slot} input={input} onResolve={onResolve} />;
    case "confirm":
      return <Confirm slot={slot} input={input} onResolve={onResolve} />;
    case "text_input":
      return <TextInput slot={slot} input={input} onResolve={onResolve} />;
    case "info":
      return <InfoCard slot={slot} input={input} onResolve={onResolve} />;
    default:
      return <UnknownSlot slot={slot} input={input} onResolve={onResolve} onReject={onReject} />;
  }
}

/** Shared card chrome — same language as PermissionPrompt, brand-tinted. */
function PromptCard({
  icon,
  tone = "primary",
  children,
}: {
  icon: ReactNode;
  tone?: "primary" | "warning" | "success" | "destructive";
  children: ReactNode;
}) {
  const tones = {
    primary: "border-primary/25 bg-primary/[0.06]",
    warning: "border-warning/30 bg-warning/10",
    success: "border-success/30 bg-success/10",
    destructive: "border-destructive/30 bg-destructive/10",
  } as const;
  const iconTones = {
    primary: "border-primary/25 bg-primary/10 text-primary",
    warning: "border-warning/30 bg-warning/10 text-warning",
    success: "border-success/30 bg-success/10 text-success",
    destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  } as const;
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 shadow-sheen", tones[tone])}>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border", iconTones[tone])}>{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SelectOne({
  slot,
  input,
  onResolve,
}: {
  slot: DisplaySlot;
  input: Record<string, unknown>;
  onResolve: (slotId: string, value: unknown) => void;
}) {
  const [custom, setCustom] = useState("");
  const options = Array.isArray(input.options)
    ? (input.options as Array<{ label?: string; value?: string; description?: string }>)
    : [];
  const submitCustom = (e: FormEvent) => {
    e.preventDefault();
    if (custom.trim()) onResolve(slot.slotId, custom.trim());
  };
  return (
    <PromptCard icon={<CircleHelp className="size-3.5" />}>
      <p className="text-[12.5px] font-semibold text-foreground">{String(input.question ?? "Choose an option")}</p>
      <div className="mt-2 space-y-1.5">
        {options.map((opt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onResolve(slot.slotId, opt.value ?? opt.label ?? "")}
            className="block w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.07]"
          >
            <span className="text-[12.5px] font-medium text-foreground">{opt.label}</span>
            {opt.description && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">{opt.description}</span>}
          </button>
        ))}
      </div>
      <form onSubmit={submitCustom} className="mt-2 flex items-center gap-2">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Or answer in your own words…"
          className="h-8 text-[12.5px]"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!custom.trim()}>
          Send
        </Button>
      </form>
    </PromptCard>
  );
}

function Confirm({
  slot,
  input,
  onResolve,
}: {
  slot: DisplaySlot;
  input: Record<string, unknown>;
  onResolve: (slotId: string, value: unknown) => void;
}) {
  const danger = input.danger === true;
  return (
    <PromptCard tone={danger ? "warning" : "primary"} icon={<CircleAlert className="size-3.5" />}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-foreground">{String(input.message ?? "Confirm?")}</p>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => onResolve(slot.slotId, false)}>
            {String(input.noLabel ?? "No")}
          </Button>
          <Button size="sm" variant={danger ? "destructive" : "default"} onClick={() => onResolve(slot.slotId, true)}>
            {String(input.yesLabel ?? "Yes")}
          </Button>
        </div>
      </div>
    </PromptCard>
  );
}

function TextInput({
  slot,
  input,
  onResolve,
}: {
  slot: DisplaySlot;
  input: Record<string, unknown>;
  onResolve: (slotId: string, value: unknown) => void;
}) {
  const [value, setValue] = useState(String(input.initial ?? ""));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onResolve(slot.slotId, value.trim());
  };
  return (
    <PromptCard icon={<MessageSquareText className="size-3.5" />}>
      <p className="text-[12.5px] font-semibold text-foreground">{String(input.question ?? "The agent needs a response")}</p>
      <form onSubmit={submit} className="mt-2 flex items-center gap-2">
        <Input
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder={String(input.placeholder ?? "Type a response…")}
          className="h-8 text-[12.5px]"
        />
        <Button type="submit" size="sm" disabled={!value.trim()}>
          Send
        </Button>
      </form>
    </PromptCard>
  );
}

function InfoCard({
  slot,
  input,
  onResolve,
}: {
  slot: DisplaySlot;
  input: Record<string, unknown>;
  onResolve: (slotId: string, value: unknown) => void;
}) {
  const severity = String(input.severity ?? "info");
  const tone = severity === "warning" ? "warning" : severity === "error" ? "destructive" : severity === "success" ? "success" : "primary";
  const icon =
    severity === "warning" ? (
      <CircleAlert className="size-3.5" />
    ) : severity === "error" ? (
      <OctagonX className="size-3.5" />
    ) : severity === "success" ? (
      <CheckCircle2 className="size-3.5" />
    ) : (
      <Info className="size-3.5" />
    );
  return (
    <PromptCard tone={tone} icon={icon}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          {typeof input.title === "string" && input.title && <p className="text-[12.5px] font-semibold text-foreground">{input.title}</p>}
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">{String(input.message ?? "")}</p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => onResolve(slot.slotId, null)}>
          Got it
        </Button>
      </div>
    </PromptCard>
  );
}

function UnknownSlot({
  slot,
  input,
  onResolve,
  onReject,
}: {
  slot: DisplaySlot;
  input: Record<string, unknown>;
  onResolve: (slotId: string, value: unknown) => void;
  onReject: (slotId: string, reason?: string) => void;
}) {
  const [custom, setCustom] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (custom.trim()) onResolve(slot.slotId, custom.trim());
  };
  return (
    <PromptCard icon={<Puzzle className="size-3.5" />}>
      <p className="text-[12.5px] font-semibold text-foreground">
        The agent is waiting on <span className="font-mono text-[12px]">{slot.renderer}</span>
      </p>
      <pre className="mt-1.5 max-h-40 overflow-auto rounded-md border border-border/70 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {JSON.stringify(input, null, 2)}
      </pre>
      <form onSubmit={submit} className="mt-2 flex items-center gap-2">
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Respond…" className="h-8 text-[12.5px]" />
        <Button type="submit" size="sm" variant="secondary" disabled={!custom.trim()}>
          Send
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onReject(slot.slotId, "dismissed in dashboard")}>
          Dismiss
        </Button>
      </form>
    </PromptCard>
  );
}
