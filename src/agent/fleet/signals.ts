import { signal, z } from "station-signal";

const inputSchema = z.object({
  itemId: z.string(),
  tag: z.string(),
  payload: z.string(),
  name: z.string().optional(),
});

/**
 * Signal *shapes* shared between dispatcher (parent) and worker (child).
 *
 * Both processes import this file so input validation runs identically on
 * each side. The handlers attached here only exist as stubs so station's
 * type checker is happy — actual work lives in `worker.ts` and is selected
 * by `kind` at runtime.
 */
export const researchSignal = signal("research")
  .input(inputSchema)
  .timeout(120_000)
  .retries(1)
  .run(async () => {});

export const editFanoutSignal = signal("edit-fanout")
  .input(inputSchema)
  .timeout(60_000)
  .retries(0)
  .run(async () => {});

export const shellFanoutSignal = signal("shell-fanout")
  .input(inputSchema)
  .timeout(120_000)
  .retries(0)
  .run(async () => {});

export const SIGNAL_SCHEMAS = {
  research: researchSignal,
  "edit-fanout": editFanoutSignal,
  "shell-fanout": shellFanoutSignal,
} as const;

export type FleetInput = z.infer<typeof inputSchema>;
