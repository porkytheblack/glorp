"use client";

import * as React from "react";
import { useQuery } from "@/lib/hooks";
import { StepRail } from "./onboarding-shared";
import { ConnectProvider } from "./onboarding-provider";
import { PickModel } from "./onboarding-model";
import { PutToWork } from "./onboarding-launch";
import type { Catalog, WorkspaceDto, ProfileDto } from "@/lib/types";

interface Picked {
  providerId: string;
  models: string[];
  model: string;
}

/**
 * First-run setup: connect a provider → verify + pick a model → put the agent
 * to work. Shown in place of the hero while the namespace has no usable model.
 * Calling `onDone` once a profile is active reveals the normal Fleet.
 */
export function OnboardingFlow({ workspaces, profiles, onDone, onSkip }: { workspaces: WorkspaceDto[]; profiles: ProfileDto[]; onDone: () => void; onSkip: () => void }) {
  const catalog = useQuery<Catalog>("/models/catalog");
  const [step, setStep] = React.useState(0);
  const [picked, setPicked] = React.useState<Picked>({ providerId: "", models: [], model: "" });

  return (
    <section className="mx-auto w-full max-w-xl animate-slide-up">
      <div className="mb-7 text-center">
        <h1 className="text-display">Set up your first model</h1>
        <p className="mx-auto mt-2.5 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
          Three quick steps and Glorp can start working in a sandboxed workspace.
        </p>
      </div>

      <StepRail step={step} />

      {step === 0 && (
        <ConnectProvider
          catalog={catalog.data}
          onConnected={(providerId, models) => {
            setPicked({ providerId, models, model: "" });
            setStep(1);
          }}
        />
      )}

      {step === 1 && (
        <PickModel
          providerId={picked.providerId}
          catalog={picked.models}
          onBack={() => setStep(0)}
          onPicked={(model) => {
            setPicked((p) => ({ ...p, model }));
            setStep(2);
          }}
        />
      )}

      {step === 2 && <PutToWork model={picked.model} workspaces={workspaces} profiles={profiles} />}

      <div className="mt-7 text-center">
        {step === 2 ? (
          <button type="button" onClick={onDone} className="text-[12px] text-faint transition-colors hover:text-muted-foreground">
            Go to the Fleet →
          </button>
        ) : (
          <button type="button" onClick={onSkip} className="text-[12px] text-faint transition-colors hover:text-muted-foreground">
            Skip — I&apos;ll configure later
          </button>
        )}
      </div>
    </section>
  );
}
