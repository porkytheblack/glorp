/**
 * General settings — REAL. Surfaces Station info from `api.health()` (status +
 * version) and a read-only note that per-session "work mode" (permission mode)
 * lives inside each chat, not here. Mirrors the section chrome used elsewhere.
 */

import { useEffect, useState } from "react";
import { Settings2, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../../api/client.ts";

interface Health {
  status: string;
  version: string;
}

const MODES: { Icon: LucideIcon; label: string; hint: string }[] = [
  { Icon: ShieldCheck, label: "Normal", hint: "Asks before risky actions" },
  { Icon: Shield, label: "Auto-review", hint: "Approves routine edits" },
  { Icon: ShieldAlert, label: "Full access", hint: "Runs without prompts" },
];

function Row(p: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-glorp-border px-4 py-2.5 last:border-0">
      <span className="text-[13px] text-glorp-muted">{p.label}</span>
      <span className="text-[13px] text-glorp-text">{p.children}</span>
    </div>
  );
}

export function General() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .health()
      .then(setHealth)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <>
      <div className="flex items-center gap-2.5">
        <Settings2 size={18} className="shrink-0 text-glorp-muted" strokeWidth={1.75} />
        <h2 className="text-lg font-semibold text-glorp-text">General</h2>
      </div>

      <section className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-glorp-muted">Runtime</div>
        <div className="rounded-lg border border-glorp-border bg-glorp-surface/40">
          <Row label="Status">
            {error ? (
              <span className="text-glorp-error">Unreachable</span>
            ) : health ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-glorp-success" />
                {health.status}
              </span>
            ) : (
              <span className="text-glorp-muted">Checking…</span>
            )}
          </Row>
          <Row label="Version">
            {health ? <span className="font-mono">{health.version}</span> : <span className="text-glorp-muted">—</span>}
          </Row>
        </div>
        {error && <p className="text-[13px] text-glorp-error">{error}</p>}
      </section>

      <section className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-glorp-muted">Work mode</div>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <div key={m.label} className="rounded-lg border border-glorp-border bg-glorp-surface/40 p-3">
              <m.Icon size={16} className="text-glorp-muted" strokeWidth={1.75} />
              <div className="mt-2 text-[13px] font-medium text-glorp-text">{m.label}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-glorp-muted">{m.hint}</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-glorp-muted">
          The permission mode is set per chat from the chat's settings, not here — each session keeps its own work mode
          so you can run cautious and trusted chats side by side.
        </p>
      </section>
    </>
  );
}
