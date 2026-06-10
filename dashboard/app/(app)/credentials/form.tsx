"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Two fields side by side on a comfortable gap — the modals' paired rows. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
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
