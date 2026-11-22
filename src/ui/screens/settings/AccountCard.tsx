import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useServices, useSyncStatus } from "../../ServicesContext";

/**
 * Sign in with email + password. No email is sent at any point: Supabase only lets you edit
 * its emails after setting up your own mail server, and a sign-in link would open Safari
 * instead of the installed iPhone app anyway (TASKS.md D15).
 */
export function AccountCard() {
  const { sync, mode } = useServices();
  const status = useSyncStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === "demo") {
    return <div className="notice">You're looking at sample data. Nothing here is saved or synced.</div>;
  }

  if (!sync.configured) {
    return (
      <div className="notice">
        Sync isn't set up for this site yet, so your data lives on this device only. Connecting Supabase (see docs/SUPABASE_SETUP.md)
        turns on sign-in and keeps phone and desktop in step.
      </div>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (status.email) {
    const last = status.lastSyncedAt ? status.lastSyncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    return (
      <div className="card stack">
        <div className="setting">
          <div className="text">
            <div>{status.email}</div>
            <div className="desc">
              {status.state === "syncing" ? "Syncing…" : status.message ?? (last ? `Synced at ${last}` : "Signed in")}
            </div>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => sync.syncNow())}>
            <Icon name="refresh" size={16} /> Sync
          </button>
        </div>
        <button type="button" className="btn ghost" onClick={() => void run(() => sync.signOut())}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => (creating ? sync.createAccount(email, password) : sync.signIn(email, password)));
      }}
    >
      <div className="small muted">
        {creating
          ? "Create your account. Your phone or password manager can save the password."
          : "Sign in to back up your log and use it on your phone and computer."}
      </div>
      <input
        className="field"
        type="email"
        name="email"
        autoComplete="username"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        className="field"
        type="password"
        name="password"
        autoComplete={creating ? "new-password" : "current-password"}
        placeholder={creating ? "New password (8+ characters)" : "Password"}
        minLength={creating ? 8 : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="error-text">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy}>
        {creating ? "Create account" : "Sign in"}
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          setCreating(!creating);
          setError(null);
        }}
      >
        {creating ? "I already have an account" : "Create an account"}
      </button>
    </form>
  );
}
