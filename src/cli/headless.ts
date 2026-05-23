import * as path from "node:path";
import * as os from "node:os";
import { buildGlorp } from "../agent/glorp.ts";
import { newSessionId } from "../agent/sessions.ts";
import { getBridge } from "../shared/bridge.ts";
import { ensureApiKey } from "./env.ts";
import type { Args } from "./args.ts";

/**
 * One-shot mode for `glorp -p "<prompt>"`. Streams tool events + agent text
 * to stdout so users can pipe into other tools. Stops the agent + fleet
 * cleanly on exit.
 */
export async function runHeadless(args: Args): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  ensureApiKey(args);
  const glorp = await buildGlorp({
    workspace: args.workspace,
    sessionId: args.sessionId || newSessionId(),
    dataDir,
    provider: args.provider,
    model: args.model,
  });
  process.stdout.write("glorp> ");
  let final = "";
  getBridge().subscribe((ev) => {
    if (ev.type === "text_delta") process.stdout.write(ev.text);
    if (ev.type === "turn" && ev.turn.kind === "agent") final = ev.turn.text ?? "";
    if (ev.type === "tool_started") {
      process.stdout.write(`\n  [${ev.tool.name}] ${describeInput(ev.tool.input)}\n`);
    }
    if (ev.type === "tool_finished") {
      const ok = ev.tool.status === "success";
      const detail = ok ? "" : ` — ${ev.tool.output?.slice(0, 200) ?? ""}`;
      process.stdout.write(`\n  ${ok ? "✓" : "✗"} ${ev.tool.name}${detail}\n`);
    }
    if (ev.type === "transmission") {
      process.stderr.write(`\n[transmission] ${ev.payload}\n`);
    }
  });
  await glorp.send(args.prompt!);
  process.stdout.write("\n");
  await glorp.shutdown();
  void final;
}

function describeInput(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return String(input);
  }
}
