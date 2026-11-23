import { useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { useAction } from "../../hooks/useAction";
import { useServices, useSyncStatus } from "../../ServicesContext";
import { ProfileFields, useUsernameCheck } from "../social/ProfileFields";

type Mode = "sign-in" | "create" | "reset";

/**
 * Account and sync. Signed out: sign in, create an account (with the username friends find you
 * by), or set a new password with a code from email. Email + password, never a link: a link
 * would open Safari instead of the installed iPhone app (TASKS.md D15).
 */
export function AccountCard() {
  const { sync, mode } = useServices();
  const status = useSyncStatus();
  const [form, setForm] = useState<Mode>("sign-in");

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
  if (status.email) return <SignedIn email={status.email} />;
  if (form === "create") return <CreateAccount onSignIn={() => setForm("sign-in")} />;
  if (form === "reset") return <ResetPassword onDone={() => setForm("sign-in")} />;
  return <SignIn onCreate={() => setForm("create")} onForgot={() => setForm("reset")} />;
}

/** A form tile: a line saying what it's for, the fields, an error, and its buttons. */
function AccountForm({ intro, error, onSubmit, children }: { intro: string; error: string | null; onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="card stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="small muted">{intro}</div>
      {children}
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}

function SignedIn({ email }: { email: string }) {
  const { sync } = useServices();
  const status = useSyncStatus();
  const { busy, error, run } = useAction();
  const last = status.lastSyncedAt ? status.lastSyncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  // One row: who's signed in (and the sync status) on the left; Sign out and Sync side by side on the right.
  return (
    <div className="card stack">
      <div className="setting account-row">
        <div className="text">
          <div className="account-email">{breakableEmail(email)}</div>
          <div className="desc">{status.state === "syncing" ? "Syncing…" : status.message ?? (last ? `Synced at ${last}` : "Signed in")}</div>
        </div>
        <div className="account-actions">
          <button type="button" className="btn account-btn" onClick={() => void run(() => sync.signOut())}>
            Sign out
          </button>
          <button type="button" className="btn account-btn" disabled={busy} onClick={() => void run(() => sync.syncNow())}>
            <Icon name="refresh" size={16} /> Sync
          </button>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

function SignIn({ onCreate, onForgot }: { onCreate: () => void; onForgot: () => void }) {
  const { sync } = useServices();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  return (
    <AccountForm intro="Sign in to back up your log and use it on your phone and computer." error={error} onSubmit={() => void run(() => sync.signIn(email, password))}>
      <EmailField value={email} onChange={setEmail} />
      <input className="field" type="password" name="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button className="btn primary" type="submit" disabled={busy}>
        Sign in
      </button>
      <div className="account-links">
        <button type="button" className="btn ghost" onClick={onCreate}>
          Create an account
        </button>
        <button type="button" className="link" onClick={onForgot}>
          Forgot password?
        </button>
      </div>
    </AccountForm>
  );
}

/** A new account with its username: the username is checked first, so a taken one never leaves an account without one. */
function CreateAccount({ onSignIn }: { onSignIn: () => void }) {
  const { sync, social } = useServices();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const check = useUsernameCheck(username);
  const { busy, error, setError, run } = useAction();

  const create = () =>
    run(async () => {
      if (social.available) {
        const problem = await social.usernameProblem(username);
        if (problem) {
          setError(problem);
          return;
        }
      }
      await sync.createAccount(email, password);
      if (!social.available) return;
      try {
        await social.claimProfile(username, displayName);
      } catch (e) {
        // The account exists and is signed in; Social asks for a username until one sticks.
        setError(`Your account is ready, but the username didn't save (${(e as Error).message}). Pick one in Social.`);
      }
    });

  return (
    <AccountForm intro="Create your account. Your phone or password manager can save the password." error={error} onSubmit={() => void create()}>
      <EmailField value={email} onChange={setEmail} />
      <input
        className="field"
        type="password"
        name="password"
        autoComplete="new-password"
        placeholder="New password (8+ characters)"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {social.available && <ProfileFields username={username} displayName={displayName} onUsername={setUsername} onDisplayName={setDisplayName} check={check} />}
      <button className="btn primary" type="submit" disabled={busy || check.problem !== null}>
        Create account
      </button>
      <button type="button" className="btn ghost" onClick={onSignIn}>
        I already have an account
      </button>
    </AccountForm>
  );
}

/** Forgot password: a 6-digit code by email, then the code and a new password (which signs you in). */
function ResetPassword({ onDone }: { onDone: () => void }) {
  const { sync } = useServices();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  if (!sent) {
    return (
      <AccountForm
        intro="We'll email you a 6-digit code to set a new password."
        error={error}
        onSubmit={() =>
          void run(async () => {
            await sync.requestPasswordReset(email);
            setSent(true);
          })
        }
      >
        <EmailField value={email} onChange={setEmail} />
        <button className="btn primary" type="submit" disabled={busy}>
          Send code
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Back to sign in
        </button>
      </AccountForm>
    );
  }
  return (
    <AccountForm intro={`Enter the code sent to ${email} and pick a new password.`} error={error} onSubmit={() => void run(() => sync.resetPassword(email, code, password))}>
      <input
        className="field"
        name="code"
        aria-label="Code from the email"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      <input
        className="field"
        type="password"
        name="password"
        autoComplete="new-password"
        placeholder="New password (8+ characters)"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button className="btn primary" type="submit" disabled={busy}>
        Set password
      </button>
      <button type="button" className="btn ghost" onClick={() => void run(() => sync.requestPasswordReset(email))} disabled={busy}>
        Send a new code
      </button>
    </AccountForm>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input className="field" type="email" name="email" autoComplete="username" placeholder="you@example.com" value={value} onChange={(e) => onChange(e.target.value)} required />
  );
}

/** The address with a line-break chance after the "@", so a narrow phone wraps it as "name@" / "gmail.com". */
function breakableEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}
