"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
