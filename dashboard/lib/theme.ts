"use client";

import * as React from "react";

/**
 * Light/dark theme state. The source of truth is the `dark` class on <html>,
 * set before paint by the boot script in app/layout.tsx (reads localStorage,
 * falls back to the OS preference). This hook mirrors that state into React
 * and keeps every consumer (toggle, toaster) in sync via a window event.
 */

const KEY = "garage.theme";
const EVENT = "garage-theme";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

function readPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(pref: ThemePref): Theme {
  return pref === "system" ? systemTheme() : pref;
}

function apply(pref: ThemePref) {
  document.documentElement.classList.toggle("dark", resolveTheme(pref) === "dark");
}

export function useTheme(): { pref: ThemePref; resolved: Theme; setPref: (p: ThemePref) => void } {
  // Server renders "system"; the boot script has already set the class, so
  // the first client effect only aligns React state — no visual flip.
  const [pref, setPrefState] = React.useState<ThemePref>("system");
  const [resolved, setResolved] = React.useState<Theme>("dark");

  React.useEffect(() => {
    const sync = () => {
      const p = readPref();
      setPrefState(p);
      setResolved(resolveTheme(p));
      apply(p);
    };
    sync();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setPref = React.useCallback((p: ThemePref) => {
    if (p === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, p);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { pref, resolved, setPref };
}

/** Inline <head> script: sets the `dark` class before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
