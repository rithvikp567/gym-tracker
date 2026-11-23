import { useState } from "react";
import type { Profile } from "../../../domain/social/Profile";
import { Room } from "../../../domain/social/Room";
import type { SocialOverview } from "../../../domain/social/SocialOverview";
import { usePageHold } from "../../components/CenterBlock";
import { Sheet } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { useAction } from "../../hooks/useAction";
import { useServices } from "../../ServicesContext";
import { Avatar, ordinal } from "./Avatar";

/** Your rooms, each opening to this week's leaderboard; New room starts one with friends. */
export function RoomsList({ overview, meId }: { overview: SocialOverview; meId: string }) {
  const [creating, setCreating] = useState(false);
  const friends = overview.friends.map((f) => f.profile);
  return (
    <section aria-label="Rooms">
      <div className="section-title">
        <span>Rooms</span>
        <button type="button" className="link" onClick={() => setCreating(true)}>
          New room
        </button>
      </div>
      {overview.rooms.length === 0 ? (
        <p className="social-empty">Start a room to see who hits the most of their planned workouts each week.</p>
      ) : (
        <div className="day-cards social-cards">
          {overview.rooms.map((room) => (
            <RoomCard key={room.id} room={room} meId={meId} friends={friends} />
          ))}
        </div>
      )}
      {creating && <NewRoomSheet friends={friends} onClose={() => setCreating(false)} />}
    </section>
  );
}

/** A room: your place this week; open, the leaderboard, who's invited, last week's winner, Invite and Leave. */
function RoomCard({ room, meId, friends }: { room: Room; meId: string; friends: Profile[] }) {
  const { social } = useServices();
  const [open, setOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const { busy, error, run } = useAction();
  usePageHold(open);
  const rank = room.rankOf(meId);
  const winners = room.lastWeekWinners();
  const invitable = friends.filter((f) => !room.has(f.id));
  const id = `room-${room.id}`;
  return (
    <section className={`card day-card room-card${open ? " open" : ""}`} aria-label={room.name}>
      <button type="button" className="day-card-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="avatar room-avatar" aria-hidden>
          <Icon name="trophy" size={16} />
        </span>
        <span className="grow">
          <span className="title">{room.name}</span>
          <span className="meta">
            {room.joined().length} {room.joined().length === 1 ? "member" : "members"}
            {rank ? ` · you're ${ordinal(rank)}` : ""}
          </span>
        </span>
        <span className="caret">
          <Icon name="down" size={18} />
        </span>
      </button>
      {open && (
        <div className="day-card-body" id={id}>
          <div className="small muted">This week · planned workouts done</div>
          <ol className="board">
            {room.board().map(({ rank: place, member, tally }) => (
              <li className={`board-row${member.profile.id === meId ? " is-me" : ""}`} key={member.profile.id}>
                <span className="board-rank num">{place || "–"}</span>
                <Avatar profile={member.profile} size={26} />
                <span className="board-name">{member.profile.id === meId ? "You" : member.profile.name}</span>
                <span className="board-score num">{tally ? tally.label : "–"}</span>
              </li>
            ))}
            {room.invited().map((member) => (
              <li className="board-row is-invited" key={member.profile.id}>
                <span className="board-rank">–</span>
                <Avatar profile={member.profile} size={26} />
                <span className="board-name">{member.profile.name}</span>
                <span className="board-score small">invited</span>
              </li>
            ))}
          </ol>
          {winners.length > 0 && (
            <div className="small muted">
              Last week: {winners.map((w) => (w.profile.id === meId ? "you" : w.profile.name)).join(" and ")} {winners.length === 1 ? "won" : "tied"}
            </div>
          )}
          <div className="room-actions">
            <button type="button" className="btn" onClick={() => setInviting(true)} disabled={invitable.length === 0} title={invitable.length ? undefined : "All your friends are in this room"}>
              Invite friends
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (confirm(`Leave ${room.name}?`)) void run(() => social.leaveRoom(room.id));
              }}
            >
              Leave
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </div>
      )}
      {inviting && <InviteSheet room={room} friends={invitable} onClose={() => setInviting(false)} />}
    </section>
  );
}

function NewRoomSheet({ friends, onClose }: { friends: Profile[]; onClose: () => void }) {
  const { social } = useServices();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const { busy, error, setError, run } = useAction();
  return (
    <Sheet title="New room" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await social.createRoom(name, [...picked]);
            if (result.ok) onClose();
            else setError(result.message);
          });
        }}
      >
        <input className="field" aria-label="Room name" placeholder="Room name" maxLength={Room.NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} required />
        <FriendPicker friends={friends} picked={picked} onChange={setPicked} empty="Add friends first to invite them. You can invite more later." />
        {error && <div className="error-text">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy}>
          Create room
        </button>
      </form>
    </Sheet>
  );
}

function InviteSheet({ room, friends, onClose }: { room: Room; friends: Profile[]; onClose: () => void }) {
  const { social } = useServices();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const { busy, error, run } = useAction();
  return (
    <Sheet title={`Invite to ${room.name}`} onClose={onClose}>
      <div className="stack">
        <FriendPicker friends={friends} picked={picked} onChange={setPicked} empty="All your friends are in this room." />
        {error && <div className="error-text">{error}</div>}
        <button
          type="button"
          className="btn primary"
          disabled={busy || picked.size === 0}
          onClick={() =>
            void run(async () => {
              await social.invite(room.id, [...picked]);
              onClose();
            })
          }
        >
          Send invites
        </button>
      </div>
    </Sheet>
  );
}

/** Tick the friends to invite. */
function FriendPicker({ friends, picked, onChange, empty }: { friends: Profile[]; picked: ReadonlySet<string>; onChange: (next: ReadonlySet<string>) => void; empty: string }) {
  if (!friends.length) return <p className="muted small">{empty}</p>;
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="friend-picker" role="group" aria-label="Friends to invite">
      {friends.map((f) => (
        <label className="pick-row" key={f.id}>
          <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
          <Avatar profile={f} size={26} />
          <span className="grow">{f.name}</span>
        </label>
      ))}
    </div>
  );
}
