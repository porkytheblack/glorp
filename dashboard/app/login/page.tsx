"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { deploymentGarageUrl, garageUrl, getStoredGarageUrl, setStoredGarageUrl } from "@/lib/api";
import { BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, Spinner } from "@/components/shared";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Garage server — resolved client-side only (localStorage + window), so it
  // is loaded after mount to keep the prerendered markup stable.
  const [serverOpen, setServerOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [effectiveUrl, setEffectiveUrl] = useState("");
  const [defaultUrl, setDefaultUrl] = useState("");

  useEffect(() => {
    setServerUrl(getStoredGarageUrl() ?? "");
    setEffectiveUrl(garageUrl());
    setDefaultUrl(deploymentGarageUrl() ?? `${location.protocol}//${location.hostname}:4271`);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = serverUrl.trim().replace(/\/+$/, "");
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setServerOpen(true);
      setError("The server address must start with http:// or https://");
      return;
    }
    setStoredGarageUrl(trimmed || null); // api() resolves per request — applies immediately
    setEffectiveUrl(garageUrl());

    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch network failure — the URL is the likely culprit, surface it.
        setServerOpen(true);
        setError(`Can't reach Garage at ${garageUrl()} — check the server address.`);
      } else {
        setError(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-backdrop grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-8 flex justify-center">
          <BrandLockup markClassName="size-5" className="text-[17px]" />
        </div>

        <form onSubmit={submit} className="surface p-6">
          <h1 className="text-[15px] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Use the admin credentials provisioned on the Garage server.</p>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={username} autoFocus onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {serverOpen ? (
              <div className="space-y-1.5">
                <Label>Garage server</Label>
                <Input
                  value={serverUrl}
                  placeholder={defaultUrl}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  inputMode="url"
                  onChange={(e) => setServerUrl(e.target.value)}
                />
                <p className="text-[11px] leading-relaxed text-faint">Saved in this browser. Leave blank to use the deployment default.</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setServerOpen(true)}
                className="group flex w-full items-baseline gap-1.5 text-left text-[12px] text-faint transition-colors hover:text-muted-foreground"
              >
                <span className="shrink-0">Garage at</span>
                <span className="truncate font-mono">{effectiveUrl || "…"}</span>
                <span className="ml-auto shrink-0 underline-offset-2 group-hover:underline">Change</span>
              </button>
            )}

            {error && <ErrorState message={error} />}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : null} Sign in
            </Button>
          </div>
        </form>

        <p className="mt-5 text-center text-[12px] text-faint">Command console for the Glorp agent runtime.</p>
      </div>
    </div>
  );
}
