import React from "react";
import { createRoot } from "@opentui/react";
import { SessionPicker } from "../ui/session-picker.tsx";
import { Onboarding } from "../ui/onboarding.tsx";
import { newSessionId } from "../agent/sessions.ts";
import type { CredentialsStore } from "../agent/credentials.ts";

type AnyRenderer = any;

/**
 * Mounts the session picker at launch (full-screen variant). Resolves
 * with either the user's choice or a fresh session id if they press 'n'.
 */
export function runSessionPicker(
  renderer: AnyRenderer,
  dataDir: string,
  activeSessionId: string | undefined,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const root = createRoot(renderer);
    const finish = (id: string) => {
      root.unmount();
      resolve(id);
    };
    root.render(
      React.createElement(SessionPicker, {
        dataDir,
        variant: "launch",
        activeSessionId,
        onPick: (id: string) => finish(id),
        onNew: () => finish(newSessionId()),
        onClose: () => {
          root.unmount();
          renderer.destroy();
          console.error("\nno session selected.");
          process.exit(0);
        },
      }),
    );
  });
}

/**
 * Mounts the onboarding screen and resolves when the user picks a profile
 * (or rejects when they cancel out). The renderer is reused for the main
 * app afterward — we just unmount the onboarding root.
 */
export function runOnboardingFlow(renderer: AnyRenderer, credentials: CredentialsStore): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const root = createRoot(renderer);
    root.render(
      React.createElement(Onboarding, {
        credentials,
        onComplete: () => {
          root.unmount();
          resolve();
        },
        onCancel: () => {
          root.unmount();
          renderer.destroy();
          console.error("\nonboarding cancelled — no model configured.");
          process.exit(2);
          reject(new Error("cancelled"));
        },
      }),
    );
  });
}
