import React, { useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  CredentialsStore,
  modelAcceptsReasoning,
  normaliseReasoning,
  reasoningProviderId,
  reasoningLabel,
  reasoningOptionsFor,
} from "../agent/credentials.ts";
import type { ModelProfile } from "../agent/credentials.ts";
import type { ModelCatalog, ModelInfo } from "../agent/model-catalog.ts";
import type { ProjectConfig } from "../agent/project-config.ts";
import { applyOverrides, variantsFor } from "../agent/project-config.ts";
import { theme } from "./theme.ts";
import { Onboarding } from "./onboarding.tsx";

interface Props {
  credentials: CredentialsStore;
  catalog?: ModelCatalog;
  projectConfig?: ProjectConfig;
  activeProfileId?: string;
  onPick: (profileId: string) => void;
  onClose: () => void;
}

/**
 * Ctrl+M overlay. Shows saved profiles and:
 *   • enter — switch the active model
 *   • r     — cycle reasoning options for the highlighted profile (in place).
 *             The cycle uses the provider-specific list — GPT-5/o-series get
 *             effort levels, Anthropic gets budget tokens, OpenRouter gets
 *             the reasoningObject (effort + cap), Qwen3 gets enable_thinking.
 *   • n     — open the onboarding flow inline to add a new profile
 *   • d     — delete the highlighted profile (not the active one)
 *   • esc   — close
 */
export function ModelSwitcher({ credentials, catalog, projectConfig, activeProfileId, onPick, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [cursor, setCursor] = useState(0);
  // When non-null, the picker is showing an inline numeric editor for the
  // highlighted profile's contextLimit. Empty string means "clear override
  // and fall back to provider / catalog / default".
  const [editingContext, setEditingContext] = useState<{ profileId: string; buffer: string } | null>(null);

  const profiles = useMemo(() => credentials.listProfiles(), [credentials, tick]);
  const clampedCursor = Math.min(cursor, Math.max(0, profiles.length - 1));

  useKeyboard((key) => {
    if (adding) return;
    if (editingContext) {
      if (key.name === "escape") return setEditingContext(null);
      if (key.name === "return") {
        const profile = credentials.getProfile(editingContext.profileId);
        if (!profile) return setEditingContext(null);
        const buf = editingContext.buffer.trim();
        const next = buf === "" ? undefined : parseContextInput(buf);
        if (buf !== "" && next === null) return; // invalid — leave editor open
        credentials.upsertProfile({ ...profile, contextLimit: next ?? undefined });
        setEditingContext(null);
        setTick((t) => t + 1);
        return;
      }
      if (key.name === "backspace") {
        setEditingContext({ ...editingContext, buffer: editingContext.buffer.slice(0, -1) });
        return;
      }
      // Accept digits, "k", "m" and a single "."
      const ch = key.sequence ?? key.name ?? "";
      if (/^[0-9.kKmM]$/.test(ch)) {
        setEditingContext({ ...editingContext, buffer: editingContext.buffer + ch.toLowerCase() });
      }
      return;
    }
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
      const provider = credentials.getProvider(p.providerId);
      const effectiveProviderId = reasoningProviderId(p.providerId, provider);
      const opts = reasoningOptionsFor(effectiveProviderId, p.model);
      if (opts.length === 0) return; // model doesn't accept reasoning
      const current = normaliseReasoning(p.reasoning);
      const idx = opts.findIndex(
        (o) => JSON.stringify(o.value) === JSON.stringify(current),
      );
      const next = opts[(idx + 1) % opts.length]!;
      const updated: ModelProfile = { ...p, reasoning: next.value };
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
    if (key.name === "c") {
      const p = profiles[clampedCursor];
      if (!p) return;
      setEditingContext({
        profileId: p.id,
        buffer: p.contextLimit ? String(p.contextLimit) : "",
      });
      return;
    }
    if (key.name === "t" && projectConfig) {
      const p = profiles[clampedCursor];
      if (!p) return;
      const variants = variantsFor(projectConfig, p.providerId, p.model);
      if (variants.length === 0) return;
      // Cycle: <none> → variants[0] → variants[1] → ... → <none>
      const names = [null, ...variants.map((v) => v.name)];
      const idx = names.findIndex((n) => n === (p.variantName ?? null));
      const nextName = names[(idx + 1) % names.length] ?? null;
      credentials.upsertProfile({ ...p, variantName: nextName ?? undefined });
      if (activeProfileId === p.id) {
        // Re-pick so the runtime adapter picks up the new reasoning overlay.
        onPick(p.id);
      }
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

  const overlayW = Math.min(96, Math.max(60, width - 8));
  const overlayH = Math.min(height - 4, Math.max(12, profiles.length + 8));

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
        <text fg={theme.textDim}>↑↓ pick · enter switch · r reasoning · t variant · c context · n new · d delete · esc close</text>
        <box marginTop={1} flexDirection="column">
          {profiles.length === 0 && (
            <text fg={theme.textMuted}>
              no profiles yet — press <span fg={theme.accent}>n</span> to add one.
            </text>
          )}
          {profiles.slice(0, overlayH - 8).map((p, i) => {
            const active = p.id === activeProfileId;
            const highlighted = i === clampedCursor;
            const fg = highlighted ? theme.bg : active ? theme.accent : theme.text;
            const bg = highlighted ? theme.accent : "transparent";
            const provider = credentials.getProvider(p.providerId);
            const effectiveProviderId = reasoningProviderId(p.providerId, provider);
            const reasoningCapable = modelAcceptsReasoning(effectiveProviderId, p.model);
            const reasoningStr = reasoningCapable
              ? ` [${reasoningLabel(normaliseReasoning(p.reasoning))}]`
              : "";
            const variantStr = p.variantName ? ` ◇ ${p.variantName}` : "";
            const star = active ? "● " : "  ";

            // Build the effective model info (catalog → glorp.json overrides
            // → profile/provider overrides) so the picker row reflects what
            // pickModel will actually use.
            const catalogInfo = catalog?.getModelInfo(p.providerId, p.model);
            const merged = projectConfig
              ? applyOverrides(catalogInfo, projectConfig.provider?.[p.providerId], p.providerId, p.model)
              : (catalogInfo ?? { providerId: p.providerId, id: p.model });
            const effectiveCtx = p.contextLimit ?? provider?.contextLimit ?? merged.context;
            const ctxSource = p.contextLimit
              ? "profile"
              : provider?.contextLimit
              ? "provider"
              : merged.context
              ? "catalog"
              : "fallback";
            const ctxLabel = effectiveCtx
              ? `ctx ${formatContext(effectiveCtx)} (${ctxSource})`
              : "ctx auto";

            return (
              <box key={p.id} flexDirection="column">
                <text fg={fg} bg={bg}>{` ${star}${p.label}${variantStr}${reasoningStr} `}</text>
                <text fg={highlighted ? theme.bg : theme.textDim} bg={bg}>{`     ${ctxLabel}${formatBadges(merged)}${formatCost(merged)}`}</text>
              </box>
            );
          })}
        </box>
        {editingContext && (
          <box marginTop={1} flexDirection="column">
            <text fg={theme.accent}>
              <strong>edit context limit</strong>
            </text>
            <text fg={theme.textMuted}>
              digits, k or m (e.g. <span fg={theme.accent}>200k</span>, <span fg={theme.accent}>1m</span>, <span fg={theme.accent}>262144</span>) · empty = reset · enter save · esc cancel
            </text>
            <text fg={theme.text}>
              {"> "}{editingContext.buffer || <span fg={theme.textDim}>(unset)</span>}
            </text>
          </box>
        )}
      </box>
    </box>
  );
}

/**
 * Accept "200k", "1m", "131072", "0.5m". Returns null on garbage so the
 * editor can keep the buffer open instead of saving an invalid value.
 * Caps at a sane upper bound (16M tokens) so a typo can't break the loop.
 */
function parseContextInput(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  const base = parseFloat(m[1]!);
  if (!isFinite(base) || base <= 0) return null;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  const n = Math.round(base * mult);
  if (n < 1_000 || n > 16_000_000) return null;
  return n;
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

/**
 * Single-letter capability badges:
 *   T = tool calls supported
 *   V = vision / image-input supported
 *   R = reasoning model
 *   A = attachments (PDFs, etc.) supported
 * Returns an empty string when nothing useful applies, so the row stays tidy.
 */
function formatBadges(info: ModelInfo): string {
  const badges: string[] = [];
  if (info.tool_call) badges.push("T");
  if (info.modalities?.input?.some((m) => m === "image" || m === "video")) badges.push("V");
  if (info.reasoning) badges.push("R");
  if (info.attachment) badges.push("A");
  return badges.length ? ` · ${badges.join("")}` : "";
}

function formatCost(info: ModelInfo): string {
  const c = info.cost;
  if (!c || (c.input == null && c.output == null)) return "";
  const input = c.input != null ? `$${trimNum(c.input)}` : "?";
  const output = c.output != null ? `$${trimNum(c.output)}` : "?";
  return ` · ${input}/${output}/Mtok`;
}

function trimNum(n: number): string {
  // Strip trailing-zero noise: 5 not 5.0, 0.5 not 0.50, 1.25 stays.
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}
