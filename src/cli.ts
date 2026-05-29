#!/usr/bin/env bun
/**
 * Glorp CLI entry point.
 * Dispatches to serve, TUI, or headless mode based on arguments.
 * Each mode lives in its own file to stay under 200 lines.
 */

import { parseCliArgs, HELP_TEXT } from "./cli-args.ts";
import { GLORP_VERSION } from "./shared/version.ts";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  switch (args.command) {
    case "help":
      console.log(HELP_TEXT);
      return;

    case "version":
      console.log(`glorp ${GLORP_VERSION}`);
      return;

    case "serve": {
      const { runServe } = await import("./cli-serve.ts");
      await runServe(args);
      return;
    }

    case "migrate": {
      const { runMigrate } = await import("./cli-migrate.ts");
      await runMigrate(args);
      return;
    }

    case "doctor": {
      const { runDoctor } = await import("./cli-doctor.ts");
      await runDoctor(args);
      return;
    }

    case "headless": {
      const { runHeadless } = await import("./cli-headless.ts");
      await runHeadless(args);
      return;
    }

    case "tui": {
      const { runTui } = await import("./cli-tui.ts");
      await runTui(args);
      return;
    }
  }
}

main().catch((err) => {
  console.error("glorp crashed:", err);
  process.exit(1);
});
