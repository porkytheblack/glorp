"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Quiet light/dark switch — sun in the dark, moon in the light. */
export function ThemeToggle() {
  const { resolved, setPref } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Switch to ${next} mode`}
          onClick={() => setPref(next)}
          className="grid size-8 place-items-center rounded-md text-faint transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{next === "light" ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  );
}
