/**
 * CLI TUI mode: start or connect to the agent server, then launch the
 * terminal UI as a WebSocket client. The primary interactive experience.
 */

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { GlorpClient } from "./client/client.ts";
import { discoverServer, serverUrl } from "./client/discovery.ts";
import { startServer } from "./server/server.ts";
import { CredentialsStore } from "./agent/credentials.ts";
import { newSessionId } from "./agent/sessions.ts";
import { GLORP_VERSION } from "./shared/version.ts";
import type { CliArgs } from "./cli-args.ts";

export async function runTui(args: CliArgs): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  fs.mkdirSync(dataDir, { recursive: true });
  const credentials = new CredentialsStore(dataDir);

  // Check if credentials exist (for TUI mode, we need at least one provider)
  if (!args.provider && !credentials.hasAny() && !envHasProvider()) {
    const renderer = await createCliRenderer({ targetFps: 60, exitOnCtrlC: false, useKittyKeyboard: {} });
    await runOnboarding(renderer, credentials);
  }

  // Find or start the server.
  let url: string;
  let embeddedStop: (() => Promise<void>) | null = null;
  const existing = await discoverServer(dataDir);
  if (existing && existing.workspace === path.resolve(args.workspace)) {
    url = serverUrl(existing);
  } else {
    const port = args.port ?? (process.env.GLORP_PORT ? Number(process.env.GLORP_PORT) : undefined);
    const srv = await startServer({
      workspace: args.workspace, dataDir, port,
      token: args.token ?? process.env.GLORP_TOKEN,
      provider: args.provider, model: args.model,
      permissionMode: args.permissionMode,
    });
    url = `http://127.0.0.1:${srv.port}`;
    embeddedStop = srv.stop;
  }

  const client = new GlorpClient({
    url,
    clientId: `tui_${Date.now().toString(36)}`,
    clientName: `glorp-tui v${GLORP_VERSION}`,
    token: args.token ?? process.env.GLORP_TOKEN,
  });

  // Resolve session ID: explicit > most-recent for this project > fresh.
  // The TUI session picker (Ctrl+S) lets the user switch interactively.
  let sessionId = args.sessionId;
  if (!sessionId) {
    const sessions = await client.listSessions("project", 1);
    sessionId = sessions.sessions[0]?.id ?? newSessionId();
  }

  // Create/resume the session on the server.
  const { session_id } = await client.createSession({
    session_id: sessionId, provider: args.provider, model: args.model,
  });

  // Mount the TUI React app.
  const renderer = await createCliRenderer({ targetFps: 60, exitOnCtrlC: false, useKittyKeyboard: {} });
  const root = createRoot(renderer);

  client.connect(session_id);

  const onQuit = async () => {
    client.disconnect();
    root.unmount();
    if (embeddedStop) await embeddedStop();
    renderer.destroy();
    process.exit(0);
  };

  const onSwapSession = async (newId: string | null) => {
    const nextId = newId ?? newSessionId();
    client.disconnect();
    await client.createSession({ session_id: nextId, provider: args.provider, model: args.model });
    client.connect(nextId);
    renderApp();
  };

  // Lazy import to avoid loading TUI deps until needed.
  const { App } = await import("./tui/app.tsx");

  const renderApp = () => {
    root.render(React.createElement(App, {
      client, workspace: args.workspace,
      onQuit, onSwapSession: (s: string | null) => void onSwapSession(s),
    }));
  };

  if (args.prompt) queueMicrotask(() => client.send(args.prompt!));
  renderApp();

  let busy = false;
  client.subscribe((msg) => { if (msg.type === "busy") busy = (msg as any).busy; });
  process.on("SIGINT", () => { if (busy) client.abort(); else void onQuit(); });
  process.on("SIGTERM", () => void onQuit());
}

async function runOnboarding(renderer: any, credentials: CredentialsStore): Promise<void> {
  const { Onboarding } = await import("./ui/onboarding.tsx");
  await new Promise<void>((resolve, reject) => {
    const root = createRoot(renderer);
    root.render(React.createElement(Onboarding, {
      credentials,
      onComplete: () => { root.unmount(); resolve(); },
      onCancel: () => {
        root.unmount(); renderer.destroy();
        console.error("\nonboarding cancelled.");
        process.exit(2);
        reject(new Error("cancelled"));
      },
    }));
  });
}

function envHasProvider(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY,
  );
}
