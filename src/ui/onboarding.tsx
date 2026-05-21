import React, { useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  CredentialsStore,
  KNOWN_PROVIDERS,
  findKnownProvider,
  modelAcceptsReasoning,
  reasoningKindFor,
  reasoningOptionsFor,
} from "../agent/credentials.ts";
import type {
  ModelProfile,
  ProviderConfig,
  ReasoningConfig,
} from "../agent/credentials.ts";
import { theme, BANNER } from "./theme.ts";

type Step =
  | { kind: "pick-provider" }
  | { kind: "enter-key"; providerId: string }
  | { kind: "custom-name" }
  | { kind: "custom-baseurl"; name: string }
  | { kind: "custom-apikey"; name: string; baseURL: string }
  | { kind: "pick-model"; providerId: string }
  | { kind: "pick-reasoning"; providerId: string; model: string }
  | { kind: "done" };

interface Props {
  credentials: CredentialsStore;
  onComplete: (profile: ModelProfile) => void;
  onCancel: () => void;
}

const CUSTOM_LABEL = "Custom (your own endpoint)";

export function Onboarding({ credentials, onComplete, onCancel }: Props) {
  const { width, height } = useTerminalDimensions();
  const [step, setStep] = useState<Step>({ kind: "pick-provider" });
  const [input, setInput] = useState("");

  useKeyboard((key) => {
    if (key.name === "escape") onCancel();
  });

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.bg}
      padding={2}
    >
      <Header width={width} />
      <box flexDirection="column" flexGrow={1} marginTop={1}>
        {step.kind === "pick-provider" && (
          <PickProvider
            onPick={(providerId) => {
              if (providerId === "__custom__") setStep({ kind: "custom-name" });
              else setStep({ kind: "enter-key", providerId });
            }}
          />
        )}
        {step.kind === "enter-key" && (
          <EnterKey
            providerId={step.providerId}
            value={input}
            onChange={setInput}
            onSubmit={(apiKey) => {
              const meta = findKnownProvider(step.providerId);
              if (!meta) return;
              const cfg: ProviderConfig = {
                type: "known",
                id: step.providerId,
                apiKey: apiKey.trim() || undefined,
              };
              credentials.upsertProvider(cfg);
              setInput("");
              setStep({ kind: "pick-model", providerId: step.providerId });
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "pick-provider" });
            }}
          />
        )}
        {step.kind === "custom-name" && (
          <CustomName
            value={input}
            onChange={setInput}
            onSubmit={(name) => {
              setInput("");
              setStep({ kind: "custom-baseurl", name });
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "pick-provider" });
            }}
          />
        )}
        {step.kind === "custom-baseurl" && (
          <CustomBaseURL
            name={step.name}
            value={input}
            onChange={setInput}
            onSubmit={(baseURL) => {
              setInput("");
              setStep({ kind: "custom-apikey", name: step.name, baseURL });
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "custom-name" });
            }}
          />
        )}
        {step.kind === "custom-apikey" && (
          <CustomApiKey
            name={step.name}
            baseURL={step.baseURL}
            value={input}
            onChange={setInput}
            onSubmit={(apiKey) => {
              const providerId = `custom-${step.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
              const cfg: ProviderConfig = {
                type: "custom",
                id: providerId,
                baseURL: step.baseURL,
                apiKey: apiKey.trim() || undefined,
              };
              credentials.upsertProvider(cfg);
              setInput("");
              setStep({ kind: "pick-model", providerId });
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "custom-baseurl", name: step.name });
            }}
          />
        )}
        {step.kind === "pick-model" && (
          <PickModel
            providerId={step.providerId}
            onPick={(model) => {
              if (modelAcceptsReasoning(step.providerId, model)) {
                setStep({ kind: "pick-reasoning", providerId: step.providerId, model });
              } else {
                finalize(credentials, step.providerId, model, { kind: "off" }, onComplete);
              }
            }}
            onBack={() => {
              const provider = credentials.getProvider(step.providerId);
              if (provider?.type === "custom") {
                setStep({ kind: "custom-apikey", name: step.providerId.replace(/^custom-/, ""), baseURL: provider.baseURL ?? "" });
              } else {
                setStep({ kind: "enter-key", providerId: step.providerId });
              }
            }}
          />
        )}
        {step.kind === "pick-reasoning" && (
          <PickReasoning
            providerId={step.providerId}
            model={step.model}
            onPick={(reasoning) => {
              finalize(credentials, step.providerId, step.model, reasoning, onComplete);
            }}
            onBack={() => setStep({ kind: "pick-model", providerId: step.providerId })}
          />
        )}
      </box>
      <box flexDirection="row" paddingTop={1}>
        <text fg={theme.textDim}>esc to exit · backspace returns to the previous step</text>
      </box>
    </box>
  );
}

function Header({ width }: { width: number }) {
  // Only show the full ASCII banner when the terminal is wide enough.
  const wide = width >= 60;
  return (
    <box flexDirection="column" alignItems="flex-start">
      {wide &&
        BANNER.map((line, i) => (
          <text key={i} fg={theme.accent}>
            {line}
          </text>
        ))}
      <text fg={theme.text}>
        <span fg={theme.accent}>glorp</span> first-contact · let's get you wired in.
      </text>
      <text fg={theme.textMuted}>
        Pick a provider, drop in an API key, choose a model. Keys live at
        ~/.glorp/credentials.json (mode 0600).
      </text>
    </box>
  );
}

function PickProvider({ onPick }: { onPick: (id: string) => void }) {
  const options = useMemo(
    () => [
      ...KNOWN_PROVIDERS.map((p) => ({
        name: p.label,
        description: p.description,
        value: p.id,
      })),
      { name: CUSTOM_LABEL, description: "Any OpenAI-compatible endpoint", value: "__custom__" },
    ],
    [],
  );

  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>1. Pick a provider</strong>
      </text>
      <text fg={theme.textMuted}>↑↓ to navigate · enter to select</text>
      <box marginTop={1}>
        <select
          options={options}
          focused
          height={Math.min(12, options.length + 2)}
          onSelect={(_i: number, opt: any) => opt && onPick(opt.value)}
        />
      </box>
    </box>
  );
}

function EnterKey(props: {
  providerId: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onBack: () => void;
}) {
  const meta = findKnownProvider(props.providerId);
  const optional = meta?.needsApiKey === false;
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>2. {meta?.label} — API key{optional ? " (optional)" : ""}</strong>
      </text>
      <text fg={theme.textMuted}>
        {optional
          ? "Press enter to skip — Ollama runs locally and doesn't need a key."
          : `Set or paste your ${meta?.envVar} value. It's persisted to ~/.glorp/credentials.json.`}
      </text>
      <box marginTop={1} border borderColor={theme.borderActive} padding={0} paddingX={1} height={3}>
        <text fg={theme.accent}>
          <strong>›</strong>
        </text>
        <text> </text>
        <GlorpInput
          value={props.value}
          onChange={props.onChange}
          onSubmit={props.onSubmit}
          focused
          placeholder={optional ? "(leave empty)" : "sk-..."}
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
        />
      </box>
      <text fg={theme.textDim}>enter ↩ to continue</text>
    </box>
  );
}

function CustomName(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onBack: () => void;
}) {
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>2. Custom provider — name</strong>
      </text>
      <text fg={theme.textMuted}>
        Short identifier (e.g. "deepinfra", "togetherai"). Stored as
        custom-&lt;name&gt;.
      </text>
      <box marginTop={1} border borderColor={theme.borderActive} padding={0} paddingX={1} height={3}>
        <text fg={theme.accent}>
          <strong>›</strong>
        </text>
        <text> </text>
        <GlorpInput
          value={props.value}
          onChange={props.onChange}
          onSubmit={(v) => v.trim() && props.onSubmit(v.trim())}
          focused
          placeholder="deepinfra"
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
        />
      </box>
    </box>
  );
}

function CustomBaseURL(props: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onBack: () => void;
}) {
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>3. {props.name} — base URL</strong>
      </text>
      <text fg={theme.textMuted}>OpenAI-compatible endpoint (e.g. https://api.example.com/v1).</text>
      <box marginTop={1} border borderColor={theme.borderActive} padding={0} paddingX={1} height={3}>
        <text fg={theme.accent}>
          <strong>›</strong>
        </text>
        <text> </text>
        <GlorpInput
          value={props.value}
          onChange={props.onChange}
          onSubmit={(v) => v.trim() && props.onSubmit(v.trim())}
          focused
          placeholder="https://api.example.com/v1"
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
        />
      </box>
    </box>
  );
}

function CustomApiKey(props: {
  name: string;
  baseURL: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onBack: () => void;
}) {
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>4. {props.name} — API key (optional)</strong>
      </text>
      <text fg={theme.textMuted}>
        Leave empty for unauthenticated endpoints. Endpoint: {props.baseURL}
      </text>
      <box marginTop={1} border borderColor={theme.borderActive} padding={0} paddingX={1} height={3}>
        <text fg={theme.accent}>
          <strong>›</strong>
        </text>
        <text> </text>
        <GlorpInput
          value={props.value}
          onChange={props.onChange}
          onSubmit={props.onSubmit}
          focused
          placeholder="(optional)"
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
        />
      </box>
    </box>
  );
}

function PickModel(props: { providerId: string; onPick: (model: string) => void; onBack: () => void }) {
  const meta = findKnownProvider(props.providerId);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<"pick" | "type">(meta ? "pick" : "type");
  const options = useMemo(() => {
    const base =
      meta?.defaultModels.map((m) => ({ name: m, value: m, description: "" })) ?? [];
    if (meta) base.push({ name: "(type a custom model name)", value: "__type__", description: "" });
    return base;
  }, [meta]);

  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>{meta ? "3" : "5"}. Pick a model</strong>
      </text>
      <text fg={theme.textMuted}>
        Provider: {meta?.label ?? props.providerId}
      </text>
      {mode === "pick" && (
        <box marginTop={1}>
          <select
            options={options}
            focused
            height={Math.min(10, options.length + 2)}
            onSelect={(_i: number, opt: any) => {
              if (!opt) return;
              if (opt.value === "__type__") setMode("type");
              else props.onPick(opt.value);
            }}
          />
        </box>
      )}
      {mode === "type" && (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.textMuted}>Model name as the provider expects it.</text>
          <box border borderColor={theme.borderActive} padding={0} paddingX={1} height={3}>
            <text fg={theme.accent}>
              <strong>›</strong>
            </text>
            <text> </text>
            <GlorpInput
              value={typed}
              onChange={setTyped}
              onSubmit={(v) => v.trim() && props.onPick(v.trim())}
              focused
              placeholder="model name"
              textColor={theme.text}
              placeholderColor={theme.textDim}
              cursorColor={theme.accent}
            />
          </box>
        </box>
      )}
    </box>
  );
}

function PickReasoning(props: {
  providerId: string;
  model: string;
  onPick: (r: ReasoningConfig) => void;
  onBack: () => void;
}) {
  // Provider-specific options: GPT/o-series get effort levels, Anthropic
  // gets budget_tokens, OpenRouter gets the reasoningObject, Qwen3 gets
  // enable_thinking + budget. The select shows whichever set applies.
  const reasoningOptions = useMemo(
    () => reasoningOptionsFor(props.providerId, props.model),
    [props.providerId, props.model],
  );
  const kind = reasoningKindFor(props.providerId, props.model);
  const opts = reasoningOptions.map((o, i) => ({
    name: o.label,
    value: String(i),
    description: o.description ?? "",
  }));
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>4. Reasoning ({kind ?? "n/a"})</strong>
      </text>
      <text fg={theme.textMuted}>
        {props.model} on {props.providerId} accepts a thinking hint. You can change this later with Ctrl+M.
      </text>
      <box marginTop={1}>
        <select
          options={opts}
          focused
          height={Math.min(12, opts.length + 2)}
          onSelect={(_i: number, opt: any) => {
            if (!opt) return;
            const idx = Number(opt.value);
            const chosen = reasoningOptions[idx];
            if (chosen) props.onPick(chosen.value);
          }}
        />
      </box>
    </box>
  );
}

/**
 * Save the picked profile and bulk-create one profile per other model the
 * provider knows about. The picked model becomes active; the rest are
 * available immediately in Ctrl+M without a second onboarding pass.
 *
 * Reasoning config is only applied to models that actually accept the same
 * `reasoning.kind` — e.g. picking "high effort" for GPT-5 won't propagate
 * to GPT-4.1 (which doesn't accept effort hints).
 */
function finalize(
  credentials: CredentialsStore,
  providerId: string,
  model: string,
  reasoning: ReasoningConfig,
  onComplete: (p: ModelProfile) => void,
): void {
  const known = findKnownProvider(providerId);
  const allModels = new Set<string>([model, ...(known?.defaultModels ?? [])]);
  let activeProfile: ModelProfile | null = null;
  const now = new Date().toISOString();

  for (const m of allModels) {
    // Only propagate the reasoning config when the kind matches what the
    // model accepts. Otherwise default to off.
    const isChosen = m === model;
    const supports = reasoningKindFor(providerId, m);
    const matchesKind =
      reasoning.kind !== "off" && supports !== null && supports === reasoning.kind;
    const r: ReasoningConfig = isChosen
      ? reasoning
      : matchesKind
        ? reasoning
        : { kind: "off" };
    const id = CredentialsStore.makeProfileId(providerId, m, r);
    const shortName = m.split("/").at(-1) ?? m;
    const labelSuffix = r.kind === "off" ? "" : ` · ${reasoningLabelFor(r)}`;
    const label = `${providerId} · ${shortName}${labelSuffix}`;
    const profile: ModelProfile = {
      id,
      label,
      providerId,
      model: m,
      reasoning: r,
      lastUsedAt: isChosen ? now : undefined,
    };
    credentials.upsertProfile(profile);
    if (isChosen) activeProfile = profile;
  }
  if (activeProfile) {
    credentials.setActive(activeProfile.id);
    onComplete(activeProfile);
  }
}

function reasoningLabelFor(r: ReasoningConfig): string {
  if (r.kind === "off") return "off";
  if (r.kind === "effort") return r.effort;
  if (r.kind === "thinking") return `${r.budget_tokens}b`;
  if (r.kind === "reasoningObject") return r.effort;
  if (r.kind === "qwenThinking") return r.enabled ? "on" : "off";
  return "";
}

// ====================================================================
// Typed input wrapper — same trick we use in input-bar.tsx to dodge
// the JSX intersection between OpenTUI's <input> and React DOM's <input>.
// ====================================================================

interface GlorpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focused?: boolean;
  textColor?: string;
  placeholderColor?: string;
  cursorColor?: string;
}

function GlorpInput(props: GlorpInputProps): React.ReactElement {
  return React.createElement(
    "input",
    props as unknown as React.InputHTMLAttributes<HTMLInputElement>,
  );
}
