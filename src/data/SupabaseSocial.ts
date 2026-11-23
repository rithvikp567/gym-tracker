import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalDate } from "../domain/LocalDate";
import { Profile, type ProfileData } from "../domain/social/Profile";
import { Room, type MemberStatus } from "../domain/social/Room";
import type { FriendRequestOutcome, SocialOverview } from "../domain/social/SocialOverview";
import type { Username } from "../domain/social/Username";
import { WeekTally, type WeekTallyData } from "../domain/social/WeekTally";
import { SocialError, type FriendRecords, type SocialGateway, type SocialProblem } from "../services/ports";

/** gt_social_overview's JSON (supabase/migrations/0002_social.sql). */
interface OverviewJson {
  me: ProfileData | null;
  incoming: ProfileData[];
  outgoing: ProfileData[];
  friends: { profile: ProfileData; thisWeek: WeekTallyData | null; streak: number }[];
  invites: { roomId: string; roomName: string; invitedBy: ProfileData | null }[];
  rooms: {
    id: string;
    name: string;
    ownerId: string;
    members: { profile: ProfileData; status: MemberStatus; thisWeek: WeekTallyData | null; lastWeek: WeekTallyData | null; streak: number }[];
  }[];
}

const OUTCOMES: Record<string, FriendRequestOutcome> = {
  sent: "sent",
  accepted: "accepted",
  not_found: "not-found",
  self: "self",
  already_friends: "already-friends",
  already_requested: "already-requested",
};

/**
 * Friends and rooms through the `gt_…` functions in supabase/migrations/0002_social.sql. Every
 * call that crosses accounts is a database function that checks who's asking; the only table
 * written directly is your own weekly_tallies.
 */
export class SupabaseSocial implements SocialGateway {
  readonly available = true;

  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: () => string | null,
  ) {}

  async isUsernameFree(username: Username): Promise<boolean> {
    return this.call<boolean>("gt_username_available", { name: username.value });
  }

  async claimProfile(username: Username, displayName: string): Promise<Profile> {
    return Profile.from(await this.call<ProfileData>("gt_claim_profile", { name: username.value, display: displayName }));
  }

  async overview(thisWeek: LocalDate, lastWeek: LocalDate): Promise<SocialOverview> {
    const json = await this.call<OverviewJson>("gt_social_overview", { this_week: thisWeek.toString(), last_week: lastWeek.toString() });
    return SupabaseSocial.readOverview(json);
  }

  /** gt_social_overview's JSON as domain objects. */
  static readOverview(json: OverviewJson): SocialOverview {
    const tally = (t: WeekTallyData | null | undefined) => (t ? WeekTally.from(t) : null);
    return {
      me: json.me ? Profile.from(json.me) : null,
      incoming: (json.incoming ?? []).map(Profile.from),
      outgoing: (json.outgoing ?? []).map(Profile.from),
      friends: (json.friends ?? []).map((f) => ({ profile: Profile.from(f.profile), thisWeek: tally(f.thisWeek), streak: f.streak ?? 0 })),
      invites: (json.invites ?? []).map((i) => ({ roomId: i.roomId, roomName: i.roomName, invitedBy: i.invitedBy ? Profile.from(i.invitedBy) : null })),
      rooms: (json.rooms ?? []).map((r) =>
        Room.from({
          id: r.id,
          name: r.name,
          ownerId: r.ownerId,
          members: (r.members ?? []).map((m) => ({
            profile: Profile.from(m.profile),
            status: m.status,
            thisWeek: tally(m.thisWeek),
            lastWeek: tally(m.lastWeek),
            streak: m.streak ?? 0,
          })),
        }),
      ),
    };
  }

  async requestFriend(username: Username): Promise<FriendRequestOutcome> {
    const outcome = await this.call<string>("gt_request_friend", { name: username.value });
    const known = OUTCOMES[outcome];
    if (!known) throw new SocialError("failed", `Unexpected answer: ${outcome}`);
    return known;
  }

  async answerFriend(fromId: string, accept: boolean): Promise<void> {
    await this.call("gt_answer_friend", { other: fromId, accept });
  }

  async unfriend(otherId: string): Promise<void> {
    await this.call("gt_unfriend", { other: otherId });
  }

  async friendRecords(friendId: string, since: LocalDate): Promise<FriendRecords> {
    const json = await this.call<FriendRecords>("gt_friend_records", { friend: friendId, since: since.toString() });
    return { days: json.days ?? [], split: json.split ?? null, sessions: json.sessions ?? [] };
  }

  async createRoom(name: string, inviteIds: readonly string[]): Promise<string> {
    return this.call<string>("gt_create_room", { room_name: name, invitees: [...inviteIds] });
  }

  async invite(roomId: string, inviteIds: readonly string[]): Promise<void> {
    await this.call("gt_invite_to_room", { room: roomId, invitees: [...inviteIds] });
  }

  async answerInvite(roomId: string, accept: boolean): Promise<void> {
    await this.call("gt_answer_invite", { room: roomId, accept });
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.call("gt_leave_room", { room: roomId });
  }

  async publishTallies(tallies: readonly WeekTally[], streak: number): Promise<void> {
    const userId = this.userId();
    if (!userId) throw new SocialError("signed-out", "Sign in first.");
    const rows = tallies.map((t) => ({
      user_id: userId,
      week_start: t.weekStart.toString(),
      planned: t.planned,
      done: t.done,
      streak,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await this.client.from("weekly_tallies").upsert(rows, { onConflict: "user_id,week_start" });
    if (error) throw SupabaseSocial.problem(error);
  }

  private async call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    let result: { data: unknown; error: { message: string; code?: string } | null };
    try {
      result = await this.client.rpc(fn, args);
    } catch (e) {
      throw new SocialError("offline", (e as Error).message);
    }
    if (result.error) throw SupabaseSocial.problem(result.error);
    return result.data as T;
  }

  /** What a Supabase error means for the person: the function's own `raise exception` words, or why it couldn't run. */
  static problem(error: { message: string; code?: string }): SocialError {
    const { message, code } = error;
    const is = (words: string) => message.includes(words);
    const as = (problem: SocialProblem, text: string) => new SocialError(problem, text);
    if (code === "PGRST202" || code === "42883" || code === "42P01" || /could not find the (function|table)/i.test(message)) {
      return as("not-set-up", "Social isn't switched on for this site yet.");
    }
    if (is("username_taken")) return as("username-taken", "That username is taken.");
    if (is("signed_out") || code === "PGRST301" || /jwt/i.test(message)) return as("signed-out", "Sign in first.");
    if (is("no_username")) return as("failed", "Pick a username first.");
    if (is("not_friends")) return as("not-friends", "You aren't friends anymore.");
    if (is("not_member")) return as("failed", "You aren't in that room anymore.");
    if (/failed to fetch|network|load failed/i.test(message)) return as("offline", "You're offline.");
    return as("failed", message);
  }
}
