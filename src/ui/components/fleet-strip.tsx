import React from "react";
import { theme } from "../theme.ts";
import type { FleetJobUiEvent } from "../../shared/events.ts";

const KIND_GLYPH: Record<FleetJobUiEvent["kind"], string> = {
  research: "✦",
  "edit-fanout": "✎",
  "shell-fanout": "❯",
};

interface Props {
  jobs: FleetJobUiEvent[];
}

/**
 * Bottom-left strip showing currently-running fleet workers. Renders one
 * row per active job with a kind glyph, name (or tag fallback), and the
 * elapsed seconds since the worker spawned. Empty when no jobs are in
 * flight so it doesn't claim any screen real estate.
 */
export function FleetStrip({ jobs }: Props) {
  if (jobs.length === 0) return null;
  const now = Date.now();
  return (
    <box flexDirection="column" paddingX={1}>
      <text fg={theme.textDim}>{`fleet · ${jobs.length} running`}</text>
      {jobs.slice(-5).map((job) => {
        const seconds = Math.max(0, Math.floor((now - job.startedAt) / 1000));
        return (
          <text key={job.jobId} fg={theme.text}>
            {`  ${KIND_GLYPH[job.kind]} ${job.name ?? job.tag} (${seconds}s)`}
          </text>
        );
      })}
    </box>
  );
}
