import React, { useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  CredentialsStore,
  CUSTOM_PROVIDER_ADAPTERS,
  KNOWN_PROVIDERS,
  effectiveProviderId,
  findKnownProvider,
  modelAcceptsReasoning,
  reasoningKindFor,
  reasoningOptionsFor,
  reasoningProviderId,
} from "../agent/credentials.ts";
import type {
  CustomProviderAdapter,
  KnownProvider,
  ModelProfile,
  ProviderConfig,
  ReasoningConfig,
} from "../agent/credentials.ts";
import { theme, BANNER } from "./theme.ts";

type Step =
  | { kind: "pick-provider" }
  | { kind: "enter-key"; providerId: string }
  | { kind: "custom-name" }
  | { kind: "custom-basedon"; name: string }
  | { kind: "custom-baseurl"; name: string; basedOn?: KnownProvider }
  | { kind: "custom-adapter"; name: string; baseURL: string; basedOn?: KnownProvider }
  | {
      kind: "custom-apikey";
      name: string;
      baseURL: string;
      adapter: CustomProviderAdapter;
      basedOn?: KnownProvider;
    }
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
              setStep({ kind: "custom-basedon", name });
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "pick-provider" });
            }}
          />
        )}
        {step.kind === "custom-basedon" && (
          <CustomBasedOn
            name={step.name}
            onPick={(basedOn) => {
              setStep({ kind: "custom-baseurl", name: step.name, basedOn });
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "custom-name" });
            }}
          />
        )}
        {step.kind === "custom-baseurl" && (
          <CustomBaseURL
            name={step.name}
            basedOn={step.basedOn}
            value={input}
            onChange={setInput}
            onSubmit={(baseURL) => {
              setInput("");
              if (step.basedOn) {
                // basedOn already pins the adapter — skip the adapter step.
                setStep({
                  kind: "custom-apikey",
                  name: step.name,
                  baseURL,
                  basedOn: step.basedOn,
                  adapter: "openai-compat",
                });
              } else {
                setStep({ kind: "custom-adapter", name: step.name, baseURL });
              }
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "custom-basedon", name: step.name });
            }}
          />
        )}
        {step.kind === "custom-adapter" && (
          <CustomAdapter
            name={step.name}
            baseURL={step.baseURL}
            onPick={(adapter) => {
              setStep({
                kind: "custom-apikey",
                name: step.name,
                baseURL: step.baseURL,
                adapter,
                basedOn: step.basedOn,
              });
            }}
            onBack={() => {
              setInput("");
              setStep({ kind: "custom-baseurl", name: step.name, basedOn: step.basedOn });
            }}
          />
        )}
        {step.kind === "custom-apikey" && (
          <CustomApiKey
            name={step.name}
            baseURL={step.baseURL}
            adapter={step.adapter}
            basedOn={step.basedOn}
            value={input}
            onChange={setInput}
            onSubmit={(apiKey) => {
              const providerId = `custom-${step.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
              const cfg: ProviderConfig = {
                type: "custom",
                id: providerId,
                ...(step.basedOn ? { basedOn: step.basedOn } : { adapter: step.adapter }),
                baseURL: step.baseURL,
                apiKey: apiKey.trim() || undefined,
              };
              credentials.upsertProvider(cfg);
              setInput("");
              setStep({ kind: "pick-model", providerId });
            }}
            onBack={() => {
              setInput("");
              if (step.basedOn) {
                setStep({ kind: "custom-baseurl", name: step.name, basedOn: step.basedOn });
              } else {
                setStep({ kind: "custom-adapter", name: step.name, baseURL: step.baseURL });
              }
            }}
          />
        )}
        {step.kind === "pick-model" && (
          <PickModel
            providerId={step.providerId}
            provider={credentials.getProvider(step.providerId)}
            onPick={(model) => {
              const provider = credentials.getProvider(step.providerId);
              const reasoningId = reasoningProviderId(step.providerId, provider);
              if (modelAcceptsReasoning(reasoningId, model)) {
                setStep({ kind: "pick-reasoning", providerId: step.providerId, model });
              } else {
                finalize(credentials, step.providerId, model, { kind: "off" }, onComplete);
              }
            }}
            onBack={() => {
              const provider = credentials.getProvider(step.providerId);
              if (provider?.type === "custom") {
                setStep({
                  kind: "custom-apikey",
                  name: step.providerId.replace(/^custom-/, ""),
                  baseURL: provider.baseURL ?? "",
                  adapter: provider.adapter ?? "openai-compat",
                });
              } else {
                setStep({ kind: "enter-key", providerId: step.providerId });
              }
            }}
          />
        )}
        {step.kind === "pick-reasoning" && (
          <PickReasoning
            providerId={step.providerId}
            provider={credentials.getProvider(step.providerId)}
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

function CustomBasedOn(props: {
  name: string;
  onPick: (basedOn: KnownProvider | undefined) => void;
  onBack: () => void;
}) {
  const options = useMemo(
    () => [
      {
        name: "Standalone (OpenAI-compatible)",
        description: "Generic /v1/chat/completions endpoint — pick your own adapter",
        value: "__none__",
      },
      ...KNOWN_PROVIDERS.map((p) => ({
        name: `Based on ${p.label}`,
        description: `Reuse ${p.id}'s adapter, default models, and reasoning capabilities`,
        value: p.id,
      })),
    ],
    [],
  );
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>3. {props.name} — based on</strong>
      </text>
      <text fg={theme.textMuted}>
        Inherit adapter + defaults from a known provider, or stay standalone. Use this to point at a
        proxy or self-hosted endpoint that speaks the same protocol as one of the bundled providers.
      </text>
      <box marginTop={1}>
        <select
          options={options}
          focused
          height={Math.min(12, options.length + 2)}
          onSelect={(_i: number, opt: any) => {
            if (!opt) return;
            props.onPick(opt.value === "__none__" ? undefined : (opt.value as KnownProvider));
          }}
        />
      </box>
    </box>
  );
}

function CustomBaseURL(props: {
  name: string;
  basedOn?: KnownProvider;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onBack: () => void;
}) {
  const basedOnLabel = props.basedOn ? findKnownProvider(props.basedOn)?.label : null;
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>4. {props.name} — base URL</strong>
      </text>
      <text fg={theme.textMuted}>
        Endpoint URL (e.g. https://api.example.com/v1).
        {basedOnLabel ? ` Inheriting defaults from ${basedOnLabel}.` : ""}
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
          placeholder="https://api.example.com/v1"
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
        />
      </box>
    </box>
  );
}

function CustomAdapter(props: {
  name: string;
  baseURL: string;
  onPick: (adapter: CustomProviderAdapter) => void;
  onBack: () => void;
}) {
  const options = CUSTOM_PROVIDER_ADAPTERS.map((adapter) => ({
    name: adapter.label,
    value: adapter.id,
    description: adapter.description,
  }));
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>4. {props.name} — adapter</strong>
      </text>
      <text fg={theme.textMuted}>Endpoint: {props.baseURL}</text>
      <box marginTop={1}>
        <select
          options={options}
          focused
          height={Math.min(8, options.length + 2)}
          onSelect={(_i: number, opt: any) => opt && props.onPick(opt.value)}
        />
      </box>
    </box>
  );
}

function CustomApiKey(props: {
  name: string;
  baseURL: string;
  adapter: CustomProviderAdapter;
  basedOn?: KnownProvider;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onBack: () => void;
}) {
  const sourceLabel = props.basedOn
    ? `basedOn: ${findKnownProvider(props.basedOn)?.label ?? props.basedOn}`
    : `adapter: ${adapterLabel(props.adapter)}`;
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>5. {props.name} — API key (optional)</strong>
      </text>
      <text fg={theme.textMuted}>
        Leave empty for unauthenticated endpoints. {sourceLabel} · Endpoint: {props.baseURL}
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

function PickModel(props: {
  providerId: string;
  provider?: ProviderConfig;
  onPick: (model: string) => void;
  onBack: () => void;
}) {
  const meta = findKnownProvider(props.providerId);
  // Custom providers can inherit a default model list either via `basedOn`
  // (preferred, explicit) or via the legacy `adapter: "mimo"` shortcut.
  const inheritedDefaults = useMemo(() => {
    if (props.provider?.type !== "custom") return [];
    const inheritFrom = props.provider.basedOn ?? (props.provider.adapter === "mimo" ? "mimo" : null);
    return inheritFrom ? findKnownProvider(inheritFrom)?.defaultModels ?? [] : [];
  }, [props.provider?.basedOn, props.provider?.adapter, props.provider?.type]);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<"pick" | "type">(meta || inheritedDefaults.length > 0 ? "pick" : "type");
  const options = useMemo(() => {
    const base =
      meta?.defaultModels.map((m) => ({ name: m, value: m, description: "" })) ??
      inheritedDefaults.map((m) => ({ name: m, value: m, description: "" }));
    if (meta || inheritedDefaults.length > 0) {
      base.push({ name: "(type a custom model name)", value: "__type__", description: "" });
    }
    return base;
  }, [inheritedDefaults, meta]);

  const providerDescription = props.provider?.type === "custom"
    ? props.provider.basedOn
      ? ` · basedOn: ${findKnownProvider(props.provider.basedOn)?.label ?? props.provider.basedOn}`
      : ` · adapter: ${adapterLabel(props.provider.adapter)}`
    : "";

  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>{meta ? "3" : "6"}. Pick a model</strong>
      </text>
      <text fg={theme.textMuted}>
        Provider: {meta?.label ?? props.providerId}
        {providerDescription}
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
  provider?: ProviderConfig;
  model: string;
  onPick: (r: ReasoningConfig) => void;
  onBack: () => void;
}) {
  // Provider-specific options: GPT/o-series get effort levels, Anthropic
  // gets budget_tokens, OpenRouter gets the reasoningObject, Qwen3 gets
  // enable_thinking + budget. The select shows whichever set applies.
  const effectiveProviderId = reasoningProviderId(props.providerId, props.provider);
  const reasoningOptions = useMemo(
    () => reasoningOptionsFor(effectiveProviderId, props.model),
    [effectiveProviderId, props.model],
  );
  const kind = reasoningKindFor(effectiveProviderId, props.model);
  const opts = reasoningOptions.map((o, i) => ({
    name: o.label,
    value: String(i),
    description: o.description ?? "",
  }));
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>
        <strong>{props.provider?.type === "custom" ? "7" : "4"}. Reasoning ({kind ?? "n/a"})</strong>
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
  const provider = credentials.getProvider(providerId);
  // Inherit default model list from `basedOn` (preferred) or the legacy
  // `adapter: "mimo"` shortcut, so custom proxies show the same model
  // picker as their upstream.
  const inheritFrom = provider?.type === "custom"
    ? provider.basedOn ?? (provider.adapter === "mimo" ? "mimo" : null)
    : null;
  const inheritedDefaultModels = inheritFrom ? findKnownProvider(inheritFrom)?.defaultModels ?? [] : [];
  const effectiveReasoningProviderId = reasoningProviderId(providerId, provider);
  const allModels = new Set<string>([model, ...(known?.defaultModels ?? []), ...inheritedDefaultModels]);
  let activeProfile: ModelProfile | null = null;
  const now = new Date().toISOString();

  for (const m of allModels) {
    // Only propagate the reasoning config when the kind matches what the
    // model accepts. Otherwise default to off.
    const isChosen = m === model;
    const supports = reasoningKindFor(effectiveReasoningProviderId, m);
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

function adapterLabel(adapter: CustomProviderAdapter | undefined): string {
  return CUSTOM_PROVIDER_ADAPTERS.find((a) => a.id === (adapter ?? "openai-compat"))?.label ?? "OpenAI-compatible";
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
