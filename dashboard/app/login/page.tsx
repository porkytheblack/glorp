"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { Field } from "@/components/ui";

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
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <span className="sidebar-logo">G</span> Garage
        </div>
        <form className="card" onSubmit={submit}>
          <p className="muted mt-0" style={{ marginBottom: 18 }}>
            Sign in with the admin credentials provisioned on the server.
          </p>
          <Field label="Username">
            <input className="input" value={username} autoFocus onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && (
            <div className="badge red dot" style={{ marginBottom: 12 }}>{error}</div>
          )}
          <button type="submit" className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? <span className="spinner" /> : "Sign in"}
          </button>
        </form>
        <p className="faint mt-2" style={{ textAlign: "center", fontSize: 12 }}>
          Set <span className="code-pill">GARAGE_ADMIN_USER</span> and{" "}
          <span className="code-pill">GARAGE_ADMIN_PASSWORD</span> to enable login.
        </p>
      </div>
    </div>
  );
}
