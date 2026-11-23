import { useState, type ReactNode } from "react";
import type { SocialOverview } from "../../../domain/social/SocialOverview";
import { SocialError } from "../../../services/ports";
import { ScreenHead } from "../../components/controls";
import { useAction } from "../../hooks/useAction";
import { useRemote } from "../../hooks/useRemote";
import { href } from "../../router";
import { useServices, useSyncStatus } from "../../ServicesContext";
import { FriendsList, Requests } from "./FriendsSection";
import { ProfileFields, useUsernameCheck } from "./ProfileFields";
import { RoomsList } from "./RoomsSection";

/**
 * The Social tab (TASKS.md D53): requests and room invites, adding friends by username, your
 * friends' weeks, and rooms with a weekly leaderboard. Says what's missing first: a backend,
 * signing in, the database's social tables, or your username.
 */
export function SocialScreen() {
  const { social, mode } = useServices();
  const status = useSyncStatus();
  const signedIn = mode === "demo" || status.email !== null;

  if (!social.available) {
    return <SocialNotice>Social needs sync, which isn't set up for this site.</SocialNotice>;
  }
  if (!signedIn) {
    return (
      <SocialNotice>
        <p>Sign in to add friends and compete in rooms.</p>
        <a className="btn primary" href={href({ name: "settings" })}>
          Sign in
        </a>
      </SocialNotice>
    );
  }
  return <SignedInSocial account={status.email ?? "demo"} />;
}

function SignedInSocial({ account }: { account: string }) {
  const { social } = useServices();
  const overview = useRemote(`social.overview.${account}`, () => social.overview(), social.changes);

  if (overview.error && !overview.value) return <SocialProblemView error={overview.error} onRetry={overview.reload} />;
  if (!overview.value) return <div className="loading">Loading…</div>;
  if (!overview.value.me) return <PickUsername />;
  return <SocialHome overview={overview.value} />;
}

function SocialHome({ overview }: { overview: SocialOverview }) {
  const me = overview.me!;
  return (
    <div className="social">
      <ScreenHead title="Social" sub={me.username.handle} className="tile social-head" />
      <Requests overview={overview} />
      <FriendsList overview={overview} />
      <RoomsList overview={overview} meId={me.id} />
    </div>
  );
}

/** An account from before usernames (or whose sign-up didn't save one) picks one here. */
function PickUsername() {
  const { social } = useServices();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const check = useUsernameCheck(username);
  const { busy, error, run } = useAction();
  return (
    <div className="social">
      <ScreenHead title="Social" className="tile social-head" />
      <form
        className="tile stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => social.claimProfile(username, displayName));
        }}
      >
        <div className="small muted">Pick the username friends will find you by. Your email stays private.</div>
        <ProfileFields username={username} displayName={displayName} onUsername={setUsername} onDisplayName={setDisplayName} check={check} />
        {error && <div className="error-text">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy || check.problem !== null}>
          Save username
        </button>
      </form>
    </div>
  );
}

function SocialProblemView({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const problem = error instanceof SocialError ? error.problem : "failed";
  if (problem === "not-set-up") {
    return (
      <SocialNotice>
        <p>Social isn't switched on for this site yet. The site's owner turns it on once (docs/SOCIAL_SETUP.md).</p>
      </SocialNotice>
    );
  }
  return (
    <SocialNotice>
      <p>{problem === "offline" ? "You're offline. Friends and rooms show up when you're back online." : error.message}</p>
      <button type="button" className="btn" onClick={onRetry}>
        Try again
      </button>
    </SocialNotice>
  );
}

function SocialNotice({ children }: { children: ReactNode }) {
  return (
    <div className="social">
      <ScreenHead title="Social" className="tile social-head" />
      <div className="tile empty social-notice">{children}</div>
    </div>
  );
}
