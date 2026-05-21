import React, { useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  CredentialsStore,
  modelAcceptsReasoning,
} from "../agent/credentials.ts";
import type { ModelProfile, ReasoningEffort } from "../agent/credentials.ts";
import { theme } from "./theme.ts";
import { Onboarding } from "./onboarding.tsx";

interface Props {
  credentials: CredentialsStore;
  activeProfileId?: string;
  onPick: (profileId: string) => void;
  onClose: () => void;
}

const REASONING_OPTIONS: Array<{ value: ReasoningEffort | undefined; label: string }> = [
  { value: undefined, label: "off" },
  { value: "minimal", label: "min" },
  { value: "low", label: "low" },
  { value: "medium", label: "med" },
  { value: "high", label: "high" },
];

/**
 * Ctrl+M overlay. Shows saved profiles and:
 *   • enter — switch the active model
 *   • r     — cycle reasoning effort for the highlighted profile (in place)
 *   • n     — open the onboarding flow inline to add a new profile
 *   • d     — delete the highlighted profile (not the active one)
 *   • esc   — close
 */
export function ModelSwitcher({ credentials, activeProfileId, onPick, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [tick, setTick] = useState(0); // forces a re-read after profile edits
  const [adding, setAdding] = useState(false);
  const [cursor, setCursor] = useState(0);

  const profiles = useMemo(() => credentials.listProfiles(), [credentials, tick]);
  const clampedCursor = Math.min(cursor, Math.max(0, profiles.length - 1));

  useKeyboard((key) => {
    if (adding) return; // onboarding owns the keyboard
    if (key.name === "escape") return onClose();
    if (profiles.length === 0) {
      if (key.name === "n" || key.name === "return") setAdding(true);
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setCursor((c) => Math.min(profiles.length - 1, c + 1));
      return;
    }
    if (key.name === "return") {
      const p = profiles[clampedCursor];
      if (p) onPick(p.id);
      return;
    }
    if (key.name === "n") {
      setAdding(true);
      return;
    }
    if (key.name === "r") {
      const p = profiles[clampedCursor];
      if (!p) return;
      if (!modelAcceptsReasoning(p.providerId, p.model)) return;
      const idx = REASONING_OPTIONS.findIndex((o) => o.value === p.reasoning);
      const next = REASONING_OPTIONS[(idx + 1) % REASONING_OPTIONS.length]!;
      const updated: ModelProfile = { ...p, reasoning: next.value };
      // Bump id so cycling reasoning saves to a stable id; if the new id
      // collides with another profile, treat it as a swap-and-skip.
      const newId = CredentialsStore.makeProfileId(updated.providerId, updated.model, next.value);
      if (newId !== p.id) {
        credentials.removeProfile(p.id);
        updated.id = newId;
      }
      credentials.upsertProfile(updated);
      if (activeProfileId === p.id) credentials.setActive(newId);
      setTick((t) => t + 1);
      return;
    }
    if (key.name === "d") {
      const p = profiles[clampedCursor];
      if (!p || p.id === activeProfileId) return;
      credentials.removeProfile(p.id);
      setTick((t) => t + 1);
      return;
    }
  });

  if (adding) {
    return (
      <Onboarding
        credentials={credentials}
        onComplete={(profile) => {
          setAdding(false);
          setTick((t) => t + 1);
          onPick(profile.id);
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }

  const overlayW = Math.min(80, Math.max(54, width - 8));
  const overlayH = Math.min(20, Math.max(12, profiles.length + 8));

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      justifyContent="center"
      alignItems="center"
    >
      <box
        flexDirection="column"
        width={overlayW}
        height={overlayH}
        border
        borderStyle="rounded"
        borderColor={theme.borderActive}
        backgroundColor={theme.bgPanel}
        padding={1}
      >
        <text fg={theme.accent}>
          <strong>switch model</strong>{" "}
          <span fg={theme.textMuted}>· {profiles.length} profile{profiles.length === 1 ? "" : "s"}</span>
        </text>
        <text fg={theme.textDim}>↑↓ pick · enter switch · r reasoning · n new · d delete · esc close</text>
        <box marginTop={1} flexDirection="column">
          {profiles.length === 0 && (
            <text fg={theme.textMuted}>
              no profiles yet — press <span fg={theme.accent}>n</span> to add one.
            </text>
          )}
          {profiles.map((p, i) => {
            const active = p.id === activeProfileId;
            const highlighted = i === clampedCursor;
            const fg = highlighted ? theme.bg : active ? theme.accent : theme.text;
            const bg = highlighted ? theme.accent : "transparent";
            const reasoningCapable = modelAcceptsReasoning(p.providerId, p.model);
            const reasoningStr = reasoningCapable
              ? ` [reasoning: ${p.reasoning ?? "off"}]`
              : "";
            const star = active ? "● " : "  ";
            return (
              <text key={p.id} fg={fg} bg={bg}>
                {` ${star}${p.label}${reasoningStr} `}
              </text>
            );
          })}
        </box>
      </box>
    </box>
  );
}
