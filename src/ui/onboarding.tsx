import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  modelAcceptsReasoning,
  reasoningProviderId,
  type CredentialsStore,
  type CustomProviderAdapter,
  type ModelProfile,
  type ProviderConfig,
} from "../agent/credentials.ts";
import { theme } from "./theme.ts";
import { Header } from "./onboarding/header.tsx";
import {
  CustomAdapter,
  CustomApiKey,
  CustomBaseURL,
  CustomName,
  EnterKey,
  PickProvider,
} from "./onboarding/provider-steps.tsx";
import { PickModel, PickReasoning } from "./onboarding/model-steps.tsx";
import { finalize } from "./onboarding/finalize.ts";

type Step =
  | { kind: "pick-provider" }
  | { kind: "enter-key"; providerId: string }
  | { kind: "custom-name" }
  | { kind: "custom-baseurl"; name: string }
  | { kind: "custom-adapter"; name: string; baseURL: string }
  | { kind: "custom-apikey"; name: string; baseURL: string; adapter: CustomProviderAdapter }
  | { kind: "pick-model"; providerId: string }
  | { kind: "pick-reasoning"; providerId: string; model: string }
  | { kind: "done" };

interface Props {
  credentials: CredentialsStore;
  onComplete: (profile: ModelProfile) => void;
  onCancel: () => void;
}

export function Onboarding({ credentials, onComplete, onCancel }: Props) {
  const { width, height } = useTerminalDimensions();
  const [step, setStep] = useState<Step>({ kind: "pick-provider" });
  const [input, setInput] = useState("");

  useKeyboard((key) => {
    if (key.name === "escape") onCancel();
  });

  const advancePastModel = (providerId: string, model: string) => {
    const provider = credentials.getProvider(providerId);
    const reasoningId = reasoningProviderId(providerId, provider);
    if (modelAcceptsReasoning(reasoningId, model)) {
      setStep({ kind: "pick-reasoning", providerId, model });
    } else {
      finalize(credentials, providerId, model, { kind: "off" }, onComplete);
    }
  };

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={theme.bg} padding={2}>
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
              const cfg: ProviderConfig = { type: "known", id: step.providerId, apiKey: apiKey.trim() || undefined };
              credentials.upsertProvider(cfg);
              setInput("");
              setStep({ kind: "pick-model", providerId: step.providerId });
            }}
          />
        )}
        {step.kind === "custom-name" && (
          <CustomName value={input} onChange={setInput} onSubmit={(name) => {
            setInput("");
            setStep({ kind: "custom-baseurl", name });
          }} />
        )}
        {step.kind === "custom-baseurl" && (
          <CustomBaseURL name={step.name} value={input} onChange={setInput} onSubmit={(baseURL) => {
            setInput("");
            setStep({ kind: "custom-adapter", name: step.name, baseURL });
          }} />
        )}
        {step.kind === "custom-adapter" && (
          <CustomAdapter name={step.name} baseURL={step.baseURL} onPick={(adapter) => {
            setStep({ kind: "custom-apikey", name: step.name, baseURL: step.baseURL, adapter });
          }} />
        )}
        {step.kind === "custom-apikey" && (
          <CustomApiKey
            name={step.name}
            baseURL={step.baseURL}
            adapter={step.adapter}
            value={input}
            onChange={setInput}
            onSubmit={(apiKey) => {
              const providerId = `custom-${step.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
              credentials.upsertProvider({
                type: "custom", id: providerId, adapter: step.adapter, baseURL: step.baseURL, apiKey: apiKey.trim() || undefined,
              });
              setInput("");
              setStep({ kind: "pick-model", providerId });
            }}
          />
        )}
        {step.kind === "pick-model" && (
          <PickModel
            providerId={step.providerId}
            provider={credentials.getProvider(step.providerId)}
            onPick={(model) => advancePastModel(step.providerId, model)}
          />
        )}
        {step.kind === "pick-reasoning" && (
          <PickReasoning
            providerId={step.providerId}
            provider={credentials.getProvider(step.providerId)}
            model={step.model}
            onPick={(reasoning) => finalize(credentials, step.providerId, step.model, reasoning, onComplete)}
          />
        )}
      </box>
      <box flexDirection="row" paddingTop={1}>
        <text fg={theme.textDim}>esc to exit · backspace returns to the previous step</text>
      </box>
    </box>
  );
}
