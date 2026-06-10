"use client";

import * as React from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/shared";
import { DialogFooter } from "@/components/ui/dialog";

/** One labeled form row: a 13px label stacked over its control, with an
 * optional hint line beneath. The shared unit of the credentials modals. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[12px] leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

/** Two fields side by side on a comfortable gap — the modals' paired rows. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

/** A secret-key input with a show/hide toggle. Masks by default; reveals in
 * monospace so a pasted key reads cleanly. Same focus ring as `Input`. */
export function KeyInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input
        type={shown ? "text" : "password"}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("pr-9", shown && value && "font-mono text-[12.5px]")}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        title={shown ? "Hide key" : "Show key"}
        className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-faint transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        <span className="sr-only">{shown ? "Hide key" : "Show key"}</span>
      </button>
    </div>
  );
}

/** Post-save verification beat: a tinted band that reports whether the key
 * actually works. Success counts the live models; failure shows the classified
 * message from `verifyProvider`. Mirrors the `ErrorState` tint idiom. */
export function VerifyBanner({ state }: { state: { ok: true; models: number } | { ok: false; message: string } }) {
  if (state.ok) {
    return (
      <div className="flex animate-fade-in items-center gap-2.5 rounded-lg border border-success/30 bg-success/[0.08] px-4 py-3 text-[13px]">
        <Check className="size-4 shrink-0 text-success" />
        <span className="text-foreground/90">
          Key verified — <span className="font-medium text-foreground">{state.models}</span> model{state.models === 1 ? "" : "s"} available
        </span>
      </div>
    );
  }
  return (
    <div className="flex animate-fade-in items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-4 py-3 text-[13px]">
      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-destructive" />
      <span className="text-foreground/90">{state.message}</span>
    </div>
  );
}

/** Standard modal footer: a quiet Cancel and a right-aligned primary action
 * that shows a spinner while its submit is in flight. */
export function ModalFooter({
  onCancel,
  onSubmit,
  submitLabel,
  busy,
  disabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <DialogFooter>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button onClick={onSubmit} disabled={busy || disabled}>
        {busy ? <Spinner /> : null} {submitLabel}
      </Button>
    </DialogFooter>
  );
}

/** Convert a label into a url-safe slug — drives the `custom-<slug>` preview. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
