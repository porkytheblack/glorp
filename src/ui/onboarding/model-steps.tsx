import { useMemo, useState } from "react";
import {
  findKnownProvider,
  reasoningKindFor,
  reasoningOptionsFor,
  reasoningProviderId,
  type ProviderConfig,
  type ReasoningConfig,
} from "../../agent/credentials.ts";
import { theme } from "../theme.ts";
import { GlorpInput } from "./input.tsx";
import { adapterLabel } from "./finalize.ts";

interface PickModelProps {
  providerId: string;
  provider?: ProviderConfig;
  onPick: (model: string) => void;
}

export function PickModel(props: PickModelProps) {
  const meta = findKnownProvider(props.providerId);
  const customDefaults = useMemo(
    () => (props.provider?.type === "custom" && props.provider.adapter === "mimo"
      ? (findKnownProvider("mimo")?.defaultModels ?? [])
      : []),
    [props.provider?.adapter, props.provider?.type],
  );
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<"pick" | "type">(meta || customDefaults.length > 0 ? "pick" : "type");
  const options = useMemo(() => {
    const base = meta?.defaultModels.map((m) => ({ name: m, value: m, description: "" }))
      ?? customDefaults.map((m) => ({ name: m, value: m, description: "" }));
    if (meta || customDefaults.length > 0) {
      base.push({ name: "(type a custom model name)", value: "__type__", description: "" });
    }
    return base;
  }, [customDefaults, meta]);

  return (
    <box flexDirection="column">
      <text fg={theme.accent}><strong>{meta ? "3" : "6"}. Pick a model</strong></text>
      <text fg={theme.textMuted}>
        Provider: {meta?.label ?? props.providerId}
        {props.provider?.type === "custom" ? ` · adapter: ${adapterLabel(props.provider.adapter)}` : ""}
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
            <text fg={theme.accent}><strong>›</strong></text>
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

interface PickReasoningProps {
  providerId: string;
  provider?: ProviderConfig;
  model: string;
  onPick: (r: ReasoningConfig) => void;
}

export function PickReasoning(props: PickReasoningProps) {
  const effectiveProviderId = reasoningProviderId(props.providerId, props.provider);
  const reasoningOptions = useMemo(
    () => reasoningOptionsFor(effectiveProviderId, props.model),
    [effectiveProviderId, props.model],
  );
  const kind = reasoningKindFor(effectiveProviderId, props.model);
  const opts = reasoningOptions.map((o, i) => ({
    name: o.label, value: String(i), description: o.description ?? "",
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
