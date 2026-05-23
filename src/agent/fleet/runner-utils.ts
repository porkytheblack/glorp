import type { Run } from "station-signal";
import type { FleetJobEvent } from "../../shared/events.ts";
import type { FleetKind, FleetSignalInput, FleetSignalResult } from "./types.ts";

export function toFleetJob(
  run: Run,
  input: FleetSignalInput,
  status: FleetJobEvent["status"],
): FleetJobEvent {
  return {
    runId: run.id,
    itemId: input.itemId,
    tag: input.tag,
    name: input.name,
    kind: run.signalName as FleetKind,
    status,
    startedAt: Date.now(),
  };
}

export function parseRunInput(run: Run): FleetSignalInput | null {
  try {
    return JSON.parse(run.input) as FleetSignalInput;
  } catch {
    return null;
  }
}

export function parseRunOutput(output: string | undefined): FleetSignalResult | null {
  if (!output) return null;
  try {
    return JSON.parse(output) as FleetSignalResult;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
