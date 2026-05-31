/** Appearance — REAL. Switches between the light-glass and dark themes. */

import { Palette, Sun, Moon, CircleCheck } from "lucide-react";
import { useTheme, type Theme } from "../../state/useTheme.ts";

const THEMES: { id: Theme; label: string; hint: string; icon: typeof Sun }[] = [
  { id: "glass-light", label: "Light glass", hint: "Frosted light theme", icon: Sun },
  { id: "dark", label: "Dark · Solaris", hint: "Teal-dark theme", icon: Moon },
];

export function Appearance() {
  const [theme, setTheme] = useTheme();
  return (
    <>
      <div>
        <div className="flex items-center gap-2.5">
          <Palette size={18} className="shrink-0 text-glorp-muted" strokeWidth={1.75} />
          <h2 className="text-lg font-semibold text-glorp-text">Appearance</h2>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-glorp-muted">Choose how Glorp looks.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((t) => {
          const Icon = t.icon;
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`flex flex-col gap-2 rounded-lg border px-4 py-3 text-left transition ${
                active
                  ? "border-glorp-border-active bg-glorp-surface-2"
                  : "border-glorp-border bg-glorp-surface/40 hover:bg-glorp-surface-2"
              }`}
            >
              <div className="flex items-center justify-between">
                <Icon size={18} className="shrink-0 text-glorp-muted" strokeWidth={1.75} />
                {active && <CircleCheck size={16} className="shrink-0 text-glorp-success" />}
              </div>
              <span className="text-[13px] font-medium text-glorp-text">{t.label}</span>
              <span className="text-[12px] text-glorp-muted">{t.hint}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
