import { useEffect, useState } from "react";
import { isUsername, Username } from "../../../domain/social/Username";
import { useServices } from "../../ServicesContext";

/** What the username field says under itself. */
export interface UsernameCheck {
  /** Why it can't be had (format or taken), or null. */
  problem: string | null;
  /** Free, as far as the server knows (null while unknown). */
  free: boolean | null;
}

/**
 * Checks a username as it's typed: the format at once, whether it's taken a moment after typing
 * stops. Without a backend only the format is checked.
 */
export function useUsernameCheck(raw: string): UsernameCheck {
  const { social } = useServices();
  const [check, setCheck] = useState<UsernameCheck>({ problem: null, free: null });
  useEffect(() => {
    if (!raw.trim()) return setCheck({ problem: null, free: null });
    const parsed = Username.parse(raw);
    if (!isUsername(parsed)) return setCheck({ problem: parsed.problem, free: false });
    if (!social.available) return setCheck({ problem: null, free: null });
    setCheck({ problem: null, free: null });
    let alive = true;
    const timer = setTimeout(() => {
      social.usernameProblem(raw).then(
        (problem) => alive && setCheck({ problem, free: problem === null }),
        () => alive && setCheck({ problem: null, free: null }),
      );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [raw, social]);
  return check;
}

/** Username (with its live check) and display name, for sign-up and for picking a username later. */
export function ProfileFields({
  username,
  displayName,
  onUsername,
  onDisplayName,
  check,
}: {
  username: string;
  displayName: string;
  onUsername: (value: string) => void;
  onDisplayName: (value: string) => void;
  check: UsernameCheck;
}) {
  const parsed = Username.parse(username);
  const handle = isUsername(parsed) ? parsed.handle : null;
  return (
    <>
      <div className="stack-tight">
        <div className="username-field">
          <span className="at" aria-hidden>
            @
          </span>
          <input
            className="field"
            name="username"
            aria-label="Username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="username"
            value={username}
            onChange={(e) => onUsername(e.target.value)}
            required
          />
        </div>
        <div className={`field-hint${check.problem ? " is-bad" : ""}`} aria-live="polite">
          {check.problem ?? (check.free && handle ? `${handle} is free.` : "Friends find you by this.")}
        </div>
      </div>
      <input
        className="field"
        name="display-name"
        aria-label="Display name"
        autoComplete="nickname"
        placeholder="Display name (optional)"
        maxLength={40}
        value={displayName}
        onChange={(e) => onDisplayName(e.target.value)}
      />
    </>
  );
}
