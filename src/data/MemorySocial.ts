import { newId } from "../domain/ids";
import type { LocalDate } from "../domain/LocalDate";
import type { SessionData } from "../domain/Session";
import { Profile } from "../domain/social/Profile";
import { Room, type MemberStatus } from "../domain/social/Room";
import type { FriendRequestOutcome, SocialOverview } from "../domain/social/SocialOverview";
import type { Username } from "../domain/social/Username";
import { WeekTally } from "../domain/social/WeekTally";
import { SocialError, type FriendRecords, type SocialGateway } from "../services/ports";

interface Friendship {
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
  at: number;
}

interface Membership {
  roomId: string;
  userId: string;
  status: MemberStatus;
  invitedBy: string;
  at: number;
  /** When they joined (null while invited): the longest-standing member inherits a room. */
  joinedAt: number | null;
}

interface StoredTally {
  planned: number;
  done: number;
  streak: number;
}

/**
 * The social server in memory, for tests and the ?demo preview. Follows the same rules as
 * supabase/migrations/0002_social.sql (who may see and do what, notes removed from a friend's
 * records), so the service and screens behave here as they do against Supabase.
 * `as(userId)` gives the gateway for one signed-in person; several share one server.
 */
export class MemorySocialServer {
  private readonly profiles = new Map<string, Profile>();
  private readonly friendships: Friendship[] = [];
  private readonly rooms = new Map<string, { id: string; name: string; owner: string; at: number }>();
  private readonly members: Membership[] = [];
  private readonly tallies = new Map<string, StoredTally>();
  private readonly records = new Map<string, FriendRecords>();
  private clock = 0;

  /** The gateway as `userId` sees it (null = signed out). */
  as(userId: () => string | null): SocialGateway {
    return new MemorySocial(this, userId);
  }

  // ───── Seeding (tests and the demo) ─────

  addProfile(id: string, username: string, displayName = ""): Profile {
    const profile = Profile.from({ id, username, displayName });
    this.profiles.set(id, profile);
    return profile;
  }

  befriend(a: string, b: string, status: Friendship["status"] = "accepted"): void {
    this.friendships.push({ requester: a, addressee: b, status, at: this.tick() });
  }

  setRecords(userId: string, records: FriendRecords): void {
    this.records.set(userId, records);
  }

  setTally(userId: string, tally: WeekTally, streak: number): void {
    this.tallies.set(tallyKey(userId, tally.weekStart.toString()), { planned: tally.planned, done: tally.done, streak });
  }

  /** Adds a room as `owner` with members already in it. */
  seedRoom(name: string, owner: string, members: { id: string; status: MemberStatus }[]): string {
    const id = newId();
    this.rooms.set(id, { id, name, owner, at: this.tick() });
    this.members.push({ roomId: id, userId: owner, status: "joined", invitedBy: owner, at: this.tick(), joinedAt: this.clock });
    for (const m of members) {
      const at = this.tick();
      this.members.push({ roomId: id, userId: m.id, status: m.status, invitedBy: owner, at, joinedAt: m.status === "joined" ? at : null });
    }
    return id;
  }

  // ───── The rules (the SQL functions) ─────

  isUsernameFree(username: Username): boolean {
    return ![...this.profiles.values()].some((p) => p.username.value === username.value);
  }

  claimProfile(me: string, username: Username, displayName: string): Profile {
    const taken = [...this.profiles.values()].some((p) => p.username.value === username.value && p.id !== me);
    if (taken) throw new SocialError("username-taken", `${username.handle} is taken.`);
    return this.addProfile(me, username.value, displayName);
  }

  requestFriend(me: string, username: Username): FriendRequestOutcome {
    if (!this.profiles.has(me)) throw new SocialError("failed", "Pick a username first.");
    const them = [...this.profiles.values()].find((p) => p.username.value === username.value)?.id;
    if (!them) return "not-found";
    if (them === me) return "self";
    const existing = this.pair(me, them);
    if (existing) {
      if (existing.status === "accepted") return "already-friends";
      if (existing.requester === me) return "already-requested";
      existing.status = "accepted";
      return "accepted";
    }
    this.befriend(me, them, "pending");
    return "sent";
  }

  answerFriend(me: string, from: string, accept: boolean): void {
    const request = this.friendships.find((f) => f.requester === from && f.addressee === me && f.status === "pending");
    if (!request) return;
    if (accept) request.status = "accepted";
    else this.friendships.splice(this.friendships.indexOf(request), 1);
  }

  unfriend(me: string, other: string): void {
    const pair = this.pair(me, other);
    if (pair) this.friendships.splice(this.friendships.indexOf(pair), 1);
  }

  friendRecords(me: string, friend: string, since: LocalDate): FriendRecords {
    if (!this.isFriend(me, friend)) throw new SocialError("not-friends", "You aren't friends.");
    const records = this.records.get(friend) ?? { days: [], split: null, sessions: [] };
    const sessions = records.sessions
      .filter((s) => !s.deleted && s.date >= since.toString())
      .map((s): SessionData => ({ ...s, logs: s.logs.map((l) => ({ ...l, note: "" })) }));
    return structuredClone({ days: records.days.filter((d) => !d.deleted), split: records.split, sessions });
  }

  createRoom(me: string, name: string, invitees: readonly string[]): string {
    if (!this.profiles.has(me)) throw new SocialError("failed", "Pick a username first.");
    const id = this.seedRoom(name, me, []);
    this.invite(me, id, invitees);
    return id;
  }

  invite(me: string, roomId: string, invitees: readonly string[]): void {
    if (!this.members.some((m) => m.roomId === roomId && m.userId === me && m.status === "joined")) {
      throw new SocialError("failed", "You aren't in that room.");
    }
    for (const id of new Set(invitees)) {
      if (id === me || !this.isFriend(me, id) || this.members.some((m) => m.roomId === roomId && m.userId === id)) continue;
      this.members.push({ roomId, userId: id, status: "invited", invitedBy: me, at: this.tick(), joinedAt: null });
    }
  }

  answerInvite(me: string, roomId: string, accept: boolean): void {
    const m = this.members.find((x) => x.roomId === roomId && x.userId === me && x.status === "invited");
    if (!m) return;
    if (accept) {
      m.status = "joined";
      m.joinedAt = this.tick();
    } else {
      this.members.splice(this.members.indexOf(m), 1);
    }
  }

  leaveRoom(me: string, roomId: string): void {
    const mine = this.members.findIndex((m) => m.roomId === roomId && m.userId === me);
    if (mine >= 0) this.members.splice(mine, 1);
    const heir = this.members.filter((m) => m.roomId === roomId && m.status === "joined").sort((a, b) => a.joinedAt! - b.joinedAt!)[0];
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (!heir) {
      this.rooms.delete(roomId);
      for (let i = this.members.length - 1; i >= 0; i--) if (this.members[i]!.roomId === roomId) this.members.splice(i, 1);
    } else if (room.owner === me) {
      room.owner = heir.userId;
    }
  }

  publishTallies(me: string, tallies: readonly WeekTally[], streak: number): void {
    for (const t of tallies) this.setTally(me, t, streak);
  }

  overview(me: string, thisWeek: LocalDate, lastWeek: LocalDate): SocialOverview {
    const profile = (id: string) => this.profiles.get(id) ?? null;
    const tally = (id: string, week: LocalDate) => {
      const t = this.tallies.get(tallyKey(id, week.toString()));
      return t ? WeekTally.of(week, t.planned, t.done) : null;
    };
    const streak = (id: string) => (this.tallies.get(tallyKey(id, thisWeek.toString())) ?? this.tallies.get(tallyKey(id, lastWeek.toString())))?.streak ?? 0;
    const known = <T>(list: (T | null)[]) => list.filter((x): x is T => x !== null);
    const byAt = <T extends { at: number }>(list: T[]) => [...list].sort((a, b) => a.at - b.at);

    const friendIds = this.friendships
      .filter((f) => f.status === "accepted" && (f.requester === me || f.addressee === me))
      .map((f) => (f.requester === me ? f.addressee : f.requester));
    return {
      me: profile(me),
      incoming: known(byAt(this.friendships.filter((f) => f.addressee === me && f.status === "pending")).map((f) => profile(f.requester))),
      outgoing: known(byAt(this.friendships.filter((f) => f.requester === me && f.status === "pending")).map((f) => profile(f.addressee))),
      friends: known(friendIds.map((id) => {
        const p = profile(id);
        return p ? { profile: p, thisWeek: tally(id, thisWeek), streak: streak(id) } : null;
      })),
      invites: byAt(this.members.filter((m) => m.userId === me && m.status === "invited")).map((m) => ({
        roomId: m.roomId,
        roomName: this.rooms.get(m.roomId)?.name ?? "",
        invitedBy: profile(m.invitedBy),
      })),
      rooms: byAt([...this.rooms.values()].filter((r) => this.members.some((m) => m.roomId === r.id && m.userId === me && m.status === "joined"))).map((r) =>
        Room.from({
          id: r.id,
          name: r.name,
          ownerId: r.owner,
          members: known(byAt(this.members.filter((m) => m.roomId === r.id)).map((m) => {
            const p = profile(m.userId);
            if (!p) return null;
            // Someone only invited hasn't agreed to share scores with the room yet.
            if (m.status === "invited") return { profile: p, status: m.status, thisWeek: null, lastWeek: null, streak: 0 };
            return { profile: p, status: m.status, thisWeek: tally(m.userId, thisWeek), lastWeek: tally(m.userId, lastWeek), streak: streak(m.userId) };
          })),
        }),
      ),
    };
  }

  private isFriend(a: string, b: string): boolean {
    return this.pair(a, b)?.status === "accepted";
  }

  private pair(a: string, b: string): Friendship | undefined {
    return this.friendships.find((f) => (f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a));
  }

  private tick(): number {
    return ++this.clock;
  }
}

function tallyKey(userId: string, weekStart: string): string {
  return `${userId}|${weekStart}`;
}

/** One person's view of a `MemorySocialServer`. */
class MemorySocial implements SocialGateway {
  readonly available = true;

  constructor(
    private readonly server: MemorySocialServer,
    private readonly userId: () => string | null,
  ) {}

  private me(): string {
    const id = this.userId();
    if (!id) throw new SocialError("signed-out", "Sign in first.");
    return id;
  }

  async isUsernameFree(username: Username) { return this.server.isUsernameFree(username); }
  async claimProfile(username: Username, displayName: string) { return this.server.claimProfile(this.me(), username, displayName); }
  async overview(thisWeek: LocalDate, lastWeek: LocalDate) { return this.server.overview(this.me(), thisWeek, lastWeek); }
  async requestFriend(username: Username) { return this.server.requestFriend(this.me(), username); }
  async answerFriend(fromId: string, accept: boolean) { this.server.answerFriend(this.me(), fromId, accept); }
  async unfriend(otherId: string) { this.server.unfriend(this.me(), otherId); }
  async friendRecords(friendId: string, since: LocalDate) { return this.server.friendRecords(this.me(), friendId, since); }
  async createRoom(name: string, inviteIds: readonly string[]) { return this.server.createRoom(this.me(), name, inviteIds); }
  async invite(roomId: string, inviteIds: readonly string[]) { this.server.invite(this.me(), roomId, inviteIds); }
  async answerInvite(roomId: string, accept: boolean) { this.server.answerInvite(this.me(), roomId, accept); }
  async leaveRoom(roomId: string) { this.server.leaveRoom(this.me(), roomId); }
  async publishTallies(tallies: readonly WeekTally[], streak: number) { this.server.publishTallies(this.me(), tallies, streak); }
}
