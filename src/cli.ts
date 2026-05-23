#!/usr/bin/env bun
import { parseArgs } from "./cli/args.ts";
import { HELP } from "./cli/help.ts";
import { runHeadless } from "./cli/headless.ts";
import { runTui } from "./cli/tui.tsx";
import { GLORP_VERSION } from "./shared/version.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.worker) {
    const { runFleetWorker } = await import("./agent/fleet/worker.ts");
    await runFleetWorker();
    return;
  }
  if (args.showHelp) {
    console.log(HELP);
    return;
  }
  if (args.showVersion) {
    console.log(`glorp ${GLORP_VERSION}`);
    return;
  }
  if (args.printOnly) {
    await runHeadless(args);
    return;
  }
  await runTui(args);
}

main().catch((err) => {
  console.error("glorp crashed:", err);
  process.exit(1);
});
