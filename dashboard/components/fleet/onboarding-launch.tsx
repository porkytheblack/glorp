"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { LaunchComposer } from "./launch";
import { VerifiedLine } from "./onboarding-shared";
import type { WorkspaceDto, ProfileDto } from "@/lib/types";

const EXAMPLES = [
  "Explore this workspace and summarize what's here.",
  "Find the project's entry point and explain how it boots.",
  "List the dependencies and flag anything outdated.",
];

/** Step 3 — a brief success beat, then the real launch composer with primers. */
export function PutToWork({ model, workspaces, profiles }: { model: string; workspaces: WorkspaceDto[]; profiles: ProfileDto[] }) {
  const [prompt, setPrompt] = React.useState("");

  return (
    <div className="animate-slide-up space-y-5">
      <div className="mx-auto max-w-md">
        <VerifiedLine>
          <span className="font-mono">{model}</span> is ready
        </VerifiedLine>
      </div>

      <div className="mx-auto max-w-2xl">
        <LaunchComposer key={prompt} workspaces={workspaces} profiles={profiles} initialPrompt={prompt} />
      </div>

      <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setPrompt(e)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/40 px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Sparkles className="size-3 text-brand/70" />
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
