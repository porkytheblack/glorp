"use client";

/** Shared presentational primitives used across dashboard pages. */

import { useState, type ReactNode, type FormEvent } from "react";
import type { Toast } from "@/lib/hooks";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-row">
      <span className="spinner" /> {label}
    </div>
  );
}

export function EmptyState({ icon = "∅", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="ico">{icon}</div>
      <div>{title}</div>
      {hint && <div className="faint mt-1">{hint}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="card" style={{ borderColor: "rgba(229,84,75,0.4)" }}>
      <span className="badge red dot">error</span> <span className="muted">{message}</span>
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  idle: "green", busy: "amber", provisioning: "amber", error: "red", destroyed: "",
  ok: "green", running: "amber",
};

export function StateBadge({ state }: { state: string }) {
  const tone = STATE_TONE[state] ?? "";
  return <span className={`badge dot ${tone}`}>{state}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export interface ModalProps {
  title: string;
  subtitle?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
  busy?: boolean;
}

export function Modal({ title, subtitle, submitLabel = "Create", onClose, onSubmit, children, busy }: ModalProps) {
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        {subtitle && <p className="sub">{subtitle}</p>}
        {children}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? <span className="spinner" /> : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
      ))}
    </div>
  );
}

/** A reusable confirm-on-click delete button. */
export function DeleteButton({ onConfirm, label = "Delete" }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  if (armed) {
    return (
      <span className="row">
        <button className="btn danger sm" onClick={onConfirm}>Confirm</button>
        <button className="btn ghost sm" onClick={() => setArmed(false)}>No</button>
      </span>
    );
  }
  return <button className="btn ghost sm" onClick={() => setArmed(true)}>{label}</button>;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
