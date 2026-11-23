import { useState } from "react";
import type { Profile } from "../../../domain/social/Profile";
import type { Friend, SocialOverview } from "../../../domain/social/SocialOverview";
import { usePageHold } from "../../components/CenterBlock";
import { Icon } from "../../components/Icon";
import { useAction } from "../../hooks/useAction";
import { useRemote } from "../../hooks/useRemote";
import { useServices } from "../../ServicesContext";
import { PersonLine } from "./Avatar";

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Friend requests and room invites waiting on you. Hidden when there are none. */
export function Requests({ overview }: { overview: SocialOverview }) {
  const { social } = useServices();
  const { busy, error, run } = useAction();
  if (!overview.incoming.length && !overview.invites.length) return null;
  return (
    <section aria-label="Requests">
      <div className="section-title">Requests</div>
      <div className="tile social-list">
        {overview.incoming.map((p) => (
          <div className="social-row" key={p.id}>
            <PersonLine profile={p} />
            <div className="row-actions">
              <button type="button" className="btn primary small-btn" disabled={busy} onClick={() => void run(() => social.answerFriend(p.id, true))}>
                Accept
              </button>
              <button type="button" className="btn small-btn" disabled={busy} onClick={() => void run(() => social.answerFriend(p.id, false))}>
                Decline
              </button>
            </div>
          </div>
        ))}
        {overview.invites.map((invite) => (
          <div className="social-row" key={invite.roomId}>
            <span className="person">
              <span className="avatar room-avatar" aria-hidden>
                <Icon name="trophy" size={16} />
              </span>
              <span className="person-text">
                <span className="person-name">{invite.roomName}</span>
                <span className="person-handle">{invite.invitedBy ? `Invite from ${invite.invitedBy.name}` : "Room invite"}</span>
              </span>
            </span>
            <div className="row-actions">
              <button type="button" className="btn primary small-btn" disabled={busy} onClick={() => void run(() => social.answerInvite(invite.roomId, true))}>
                Join
              </button>
              <button type="button" className="btn small-btn" disabled={busy} onClick={() => void run(() => social.answerInvite(invite.roomId, false))}>
                Decline
              </button>
            </div>
          </div>
        ))}
        {error && <div className="error-text">{error}</div>}
      </div>
    </section>
  );
}

/** Find someone by username and send a request. */
export function AddFriend() {
  const { social } = useServices();
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form
      className="add-friend"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const outcome = await social.addFriend(name);
          setResult(outcome);
          if (outcome.ok) setName("");
        });
      }}
    >
      <div className="add-friend-row">
        <div className="username-field">
          <span className="at" aria-hidden>
            @
          </span>
          <input
            className="field"
            aria-label="Friend's username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="username"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setResult(null);
            }}
          />
        </div>
        <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
          Add
        </button>
      </div>
      {(result || error) && (
        <div className={`field-hint${result?.ok ? "" : " is-bad"}`} aria-live="polite">
          {error ?? result?.message}
        </div>
      )}
    </form>
  );
}

/** Your friends (each opens to their week and latest workouts), then requests you've sent. */
export function FriendsList({ overview }: { overview: SocialOverview }) {
  return (
    <section aria-label="Friends">
      <div className="section-title">Friends</div>
      <div className="tile stack">
        <AddFriend />
      </div>
      {overview.friends.length === 0 && overview.outgoing.length === 0 && (
        <p className="social-empty">Add a friend by their username to see their week here.</p>
      )}
      {overview.friends.length > 0 && (
        <div className="day-cards social-cards">
          {overview.friends.map((f) => (
            <FriendCard key={f.profile.id} friend={f} />
          ))}
        </div>
      )}
      {overview.outgoing.length > 0 && <Outgoing people={overview.outgoing} />}
    </section>
  );
}

function Outgoing({ people }: { people: Profile[] }) {
  const { social } = useServices();
  const { busy, run } = useAction();
  return (
    <div className="tile social-list outgoing">
      {people.map((p) => (
        <div className="social-row" key={p.id}>
          <PersonLine profile={p} size={28} />
          <div className="row-actions">
            <span className="muted small">Requested</span>
            <button type="button" className="link" disabled={busy} onClick={() => void run(() => social.unfriend(p.id))}>
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A friend: this week's score and streak; open, their week as dots and their latest workouts. */
function FriendCard({ friend }: { friend: Friend }) {
  const [open, setOpen] = useState(false);
  usePageHold(open);
  const id = `friend-${friend.profile.id}`;
  return (
    <section className={`card day-card friend-card${open ? " open" : ""}`} aria-label={friend.profile.name}>
      <button type="button" className="day-card-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="grow">
          <PersonLine profile={friend.profile} />
        </span>
        <span className="score num" title="Planned workouts done this week">
          {friend.thisWeek ? friend.thisWeek.label : "–"}
        </span>
        <span className="caret">
          <Icon name="down" size={18} />
        </span>
      </button>
      {open && (
        <div className="day-card-body" id={id}>
          <FriendDetailView friend={friend} />
        </div>
      )}
    </section>
  );
}

function FriendDetailView({ friend }: { friend: Friend }) {
  const { social } = useServices();
  const detail = useRemote(`social.friend.${friend.profile.id}`, () => social.friendDetail(friend.profile.id), social.changes);
  const { busy, run } = useAction();
  const streak = friend.streak;
  return (
    <>
      <div className="friend-week" role="img" aria-label="This week">
        {WEEKDAY_LETTERS.map((letter, i) => {
          const day = detail.value?.week[i];
          const status = day?.status;
          return (
            <span className="friend-day" key={i}>
              <span className="faint small">{letter}</span>
              <span className={`dot ${status === "done" ? "done" : status === "missed" ? "missed" : status === "planned" ? "planned" : "rest"}`} />
            </span>
          );
        })}
      </div>
      <div className="friend-stats small muted">
        {friend.thisWeek ? `${friend.thisWeek.label} planned workouts this week` : "No workouts shared this week yet"}
        {streak > 0 && ` · ${streak}-week streak`}
      </div>
      {detail.error && <div className="error-text">{detail.error.message}</div>}
      {!detail.value && !detail.error && <div className="muted small">Loading…</div>}
      {detail.value && detail.value.recent.length === 0 && <div className="muted small">No workouts in the last few weeks.</div>}
      {detail.value?.recent.map((w) => (
        <div className="recent-workout" key={w.date.toString() + w.dayName}>
          <div className="recent-head">
            <span className="title">{w.dayName}</span>
            <span className="muted small">{w.date.shortLabel()}</span>
          </div>
          <ul className="recent-lines num">
            {w.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
      <button
        type="button"
        className="link danger-link"
        disabled={busy}
        onClick={() => {
          if (confirm(`Remove ${friend.profile.name} from your friends?`)) void run(() => social.unfriend(friend.profile.id));
        }}
      >
        Remove friend
      </button>
    </>
  );
}
