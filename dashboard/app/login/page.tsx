"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/shared";

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
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex justify-center">
          <BrandLockup markClassName="size-5" className="text-[17px]" />
        </div>
        <form onSubmit={submit} className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-base font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Use the admin credentials provisioned on the Garage server.</p>
          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={username} autoFocus onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : null} Sign in
            </Button>
          </div>
        </form>
        <p className="mt-4 text-center text-[12px] text-muted-foreground">
          Set <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">GARAGE_ADMIN_USER</code> and{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">GARAGE_ADMIN_PASSWORD</code> to enable login.
        </p>
      </div>
    </div>
  );
}
