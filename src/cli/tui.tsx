import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "../ui/app.tsx";
import { buildGlorp } from "../agent/glorp.ts";
import { CredentialsStore } from "../agent/credentials.ts";
import { listSessions, newSessionId } from "../agent/sessions.ts";
import { getBridge } from "../shared/bridge.ts";
import { envHasProvider } from "./env.ts";
import { runOnboardingFlow, runSessionPicker } from "./overlay.tsx";
import type { Args } from "./args.ts";

export async function runTui(args: Args): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  fs.mkdirSync(dataDir, { recursive: true });
  const credentials = new CredentialsStore(dataDir);

  const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
  });

  if (!args.provider && !credentials.hasAny() && !envHasProvider()) {
    await runOnboardingFlow(renderer, credentials);
  }
  const sessionId = await resolveSessionId(args.sessionId, dataDir, renderer);
  let glorp = await buildGlorp({
    workspace: args.workspace,
    sessionId,
    dataDir,
    provider: args.provider,
    model: args.model,
    credentials,
  });

  const root = createRoot(renderer);
  let stopped = false;
  let busy = false;
  const unsubscribeBusy = getBridge().subscribe((ev) => {
    if (ev.type === "busy") busy = ev.busy;
  });

  const onQuit = async () => {
    if (stopped) return;
    stopped = true;
    unsubscribeBusy();
    try { await glorp.shutdown(); } finally {
      renderer.destroy();
      process.exit(0);
    }
  };

  const render = () => {
    root.render(
      React.createElement(App, {
        glorp,
        workspace: args.workspace,
        dataDir,
        onQuit,
        onSwapSession: (s: string | null) => void swapSession(s),
      }),
    );
  };

  const swapSession = async (nextSessionIdOrNull: string | null) => {
    const nextId = nextSessionIdOrNull ?? newSessionId();
    if (nextId === glorp.sessionId) return;
    await glorp.shutdown();
    getBridge().emit({ type: "session_reset" });
    glorp = await buildGlorp({
      workspace: args.workspace,
      sessionId: nextId,
      dataDir,
      provider: args.provider,
      model: args.model,
      credentials,
    });
    render();
  };

  if (args.prompt) {
    queueMicrotask(() => void glorp.send(args.prompt!));
  }
  render();

  process.on("SIGINT", () => {
    if (busy) { glorp.abort(); return; }
    void onQuit();
  });
  process.on("SIGTERM", () => void onQuit());
}

async function resolveSessionId(
  explicit: string,
  dataDir: string,
  renderer: any,
): Promise<string> {
  if (explicit) return explicit;
  const sessions = await listSessions(dataDir);
  if (sessions.length === 0) return newSessionId();
  return runSessionPicker(renderer, dataDir, undefined);
}
