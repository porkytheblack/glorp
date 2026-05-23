import { useMemo } from "react";
import { CUSTOM_PROVIDER_ADAPTERS, KNOWN_PROVIDERS, findKnownProvider, type CustomProviderAdapter } from "../../agent/credentials.ts";
import { theme } from "../theme.ts";
import { GlorpInput } from "./input.tsx";
import { adapterLabel } from "./finalize.ts";

const CUSTOM_LABEL = "Custom (your own endpoint)";

interface PromptShellProps {
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  footer?: string;
}

function PromptShell(props: PromptShellProps) {
  return (
    <box flexDirection="column">
      <text fg={theme.accent}><strong>{props.title}</strong></text>
      <text fg={theme.textMuted}>{props.hint}</text>
      <box marginTop={1} border borderColor={theme.borderActive} padding={0} paddingX={1} height={3}>
        <text fg={theme.accent}><strong>›</strong></text>
        <text> </text>
        <GlorpInput
          value={props.value}
          onChange={props.onChange}
          onSubmit={props.onSubmit}
          focused
          placeholder={props.placeholder}
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
        />
      </box>
      {props.footer && <text fg={theme.textDim}>{props.footer}</text>}
    </box>
  );
}

export function PickProvider({ onPick }: { onPick: (id: string) => void }) {
  const options = useMemo(
    () => [
      ...KNOWN_PROVIDERS.map((p) => ({ name: p.label, description: p.description, value: p.id })),
      { name: CUSTOM_LABEL, description: "Any OpenAI-compatible endpoint", value: "__custom__" },
    ],
    [],
  );
  return (
    <box flexDirection="column">
      <text fg={theme.accent}><strong>1. Pick a provider</strong></text>
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

export function EnterKey(props: { providerId: string; value: string; onChange: (v: string) => void; onSubmit: (v: string) => void }) {
  const meta = findKnownProvider(props.providerId);
  const optional = meta?.needsApiKey === false;
  return (
    <PromptShell
      title={`2. ${meta?.label} — API key${optional ? " (optional)" : ""}`}
      hint={optional
        ? "Press enter to skip — Ollama runs locally and doesn't need a key."
        : `Set or paste your ${meta?.envVar} value. It's persisted to ~/.glorp/credentials.json.`}
      value={props.value}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
      placeholder={optional ? "(leave empty)" : "sk-..."}
      footer="enter ↩ to continue"
    />
  );
}

export function CustomName(props: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void }) {
  return (
    <PromptShell
      title="2. Custom provider — name"
      hint="Short identifier (e.g. 'deepinfra', 'togetherai'). Stored as custom-<name>."
      value={props.value}
      onChange={props.onChange}
      onSubmit={(v) => v.trim() && props.onSubmit(v.trim())}
      placeholder="deepinfra"
    />
  );
}

export function CustomBaseURL(props: { name: string; value: string; onChange: (v: string) => void; onSubmit: (v: string) => void }) {
  return (
    <PromptShell
      title={`3. ${props.name} — base URL`}
      hint="Endpoint URL (e.g. https://api.example.com/v1)."
      value={props.value}
      onChange={props.onChange}
      onSubmit={(v) => v.trim() && props.onSubmit(v.trim())}
      placeholder="https://api.example.com/v1"
    />
  );
}

export function CustomAdapter(props: { name: string; baseURL: string; onPick: (adapter: CustomProviderAdapter) => void }) {
  const options = CUSTOM_PROVIDER_ADAPTERS.map((adapter) => ({
    name: adapter.label, value: adapter.id, description: adapter.description,
  }));
  return (
    <box flexDirection="column">
      <text fg={theme.accent}><strong>4. {props.name} — adapter</strong></text>
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

export function CustomApiKey(props: {
  name: string; baseURL: string; adapter: CustomProviderAdapter;
  value: string; onChange: (v: string) => void; onSubmit: (v: string) => void;
}) {
  return (
    <PromptShell
      title={`5. ${props.name} — API key (optional)`}
      hint={`Leave empty for unauthenticated endpoints. Adapter: ${adapterLabel(props.adapter)} · Endpoint: ${props.baseURL}`}
      value={props.value}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
      placeholder="(optional)"
    />
  );
}
