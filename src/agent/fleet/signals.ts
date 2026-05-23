import { signal, z } from "station-signal";
import { runFleetResearchAgent } from "../agents/fleet-research.ts";
import { runShell, shellSummary } from "./shell.ts";
import type { FleetSignalInput, FleetSignalResult } from "./types.ts";

const FleetInput = z.object({
  itemId: z.string(),
  tag: z.string(),
  payload: z.string(),
  workspace: z.string(),
  dataDir: z.string().optional(),
  name: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  profileId: z.string().optional(),
});

const FleetOutput = z.object({
  response: z.string(),
  status: z.enum(["resolved", "error"]),
});

export const researchSignal = signal("research")
  .input(FleetInput)
  .output(FleetOutput)
  .timeout(120_000)
  .retries(1)
  .run(async (input): Promise<FleetSignalResult> => {
    try {
      return { status: "resolved", response: await runFleetResearchAgent(input) };
    } catch (err: any) {
      return { status: "error", response: `research failed: ${err?.message ?? err}` };
    }
  });

export const editFanoutSignal = signal("edit-fanout")
  .input(FleetInput)
  .output(FleetOutput)
  .timeout(60_000)
  .retries(0)
  .run((input) => runShellSignal(input, 60_000));

export const shellFanoutSignal = signal("shell-fanout")
  .input(FleetInput)
  .output(FleetOutput)
  .timeout(120_000)
  .retries(0)
  .run((input) => runShellSignal(input, 120_000));

async function runShellSignal(
  input: FleetSignalInput,
  timeoutMs: number,
): Promise<FleetSignalResult> {
  const result = await runShell(input.payload, input.workspace, timeoutMs);
  return {
    status: result.exitCode === 0 ? "resolved" : "error",
    response: shellSummary(result),
  };
}
