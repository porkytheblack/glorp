#!/usr/bin/env bun
/**
 * Glorp CLI entry point.
 * Dispatches to serve, TUI, or headless mode based on arguments.
 * Each mode lives in its own file to stay under 200 lines.
 */

import { parseCliArgs, HELP_TEXT } from "./cli-args.ts";
import { GLORP_VERSION } from "./shared/version.ts";

async function main(): Promise<void> {
  // Hidden self-spawn subcommand for orchestrator subagents in the COMPILED
  // binary (the continuum node-bootstrap can't read /$bunfs script paths).
  // Handled before arg parsing — it is not a user-facing command.
  if (process.argv[2] === "__agent-run") {
    const role = process.argv[3] ?? "";
    const { runAgentSubcommand } = await import("./orchestrator/compiled-runner.ts");
    process.exit(await runAgentSubcommand(role));
  }

  // Hidden git credential helper (speaks the git-credential protocol on
  // stdin/stdout). Installed as `credential.helper` in template-cloned repos so
  // git fetch/push pulls a fresh token from the configured token service.
  if (process.argv[2] === "__git-cred") {
    const { runGitCredHelper } = await import("./garage/git-tokens.ts");
    const stdin = await new Response(Bun.stdin.stream()).text();
    process.exit(await runGitCredHelper(process.argv[3], stdin));
  }

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

    case "companion": {
      const { runCompanion } = await import("./cli-companion.ts");
      await runCompanion(args);
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

    case "mesh": {
      const { runMesh } = await import("./cli-mesh.ts");
      await runMesh(args);
      return;
    }

    case "garage": {
      if (args.garageKeysSub) {
        const { runKeys } = await import("./cli-keys.ts");
        await runKeys(args);
        return;
      }
      const { runGarage } = await import("./cli-garage.ts");
      await runGarage(args);
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
