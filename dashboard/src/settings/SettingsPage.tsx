/**
 * Settings page: a left subnav of REAL sections + content on the right. Every
 * section is functional — no "coming soon" placeholders.
 *   General  → Station runtime info + per-chat work-mode note
 *   Appearance → theme switcher (light glass / dark)
 *   Models   → providers + profiles: select active, add, remove
 */

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { General } from "./sections/General.tsx";
import { Appearance } from "./sections/Appearance.tsx";
import { Configuration } from "./sections/Configuration.tsx";

export interface SettingsPageProps {
  onBack: () => void;
}

interface SectionDef {
  id: string;
  label: string;
  render: () => React.ReactNode;
}

const SECTIONS: SectionDef[] = [
  { id: "general", label: "General", render: () => <General /> },
  { id: "appearance", label: "Appearance", render: () => <Appearance /> },
  { id: "models", label: "Models", render: () => <Configuration /> },
];

export function SettingsPage(p: SettingsPageProps) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];

  return (
    <div className="flex h-full flex-col">
      <header className="glass flex shrink-0 items-center gap-2 border-b border-glorp-border px-4 py-2.5">
        <button
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-glorp-muted hover:bg-glorp-surface-2 hover:text-glorp-text"
          onClick={p.onBack}
        >
          <ChevronLeft size={16} /> Back
        </button>
        <span className="text-glorp-text">Settings</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[210px_1fr] overflow-hidden">
        <nav className="glass overflow-y-auto border-r border-glorp-border px-2 py-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`relative block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] ${
                s.id === activeId
                  ? "bg-glorp-surface-2 text-glorp-text before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-glorp-accent"
                  : "text-glorp-muted hover:bg-glorp-surface-2 hover:text-glorp-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-2xl space-y-6">{active.render()}</div>
        </div>
      </div>
    </div>
  );
}
