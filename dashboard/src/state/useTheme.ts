/**
 * Theme switcher: writes `data-theme` on <html> and persists the choice.
 * Default is the light glassmorphic theme; "dark" is the Solaris theme.
 */

import { useEffect, useState } from "react";

export type Theme = "glass-light" | "dark";
const KEY = "glorp-theme";

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "glass-light";
  } catch {
    return "glass-light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Apply the saved theme as early as possible to avoid a flash of the wrong one. */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, setThemeState];
}
