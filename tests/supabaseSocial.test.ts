import { describe, expect, it } from "vitest";
import { SupabaseSocial } from "../src/data/SupabaseSocial";
import { LocalDate } from "../src/domain/LocalDate";
import { Username } from "../src/domain/social/Username";
import { WeekTally } from "../src/domain/social/WeekTally";
import { SocialError } from "../src/services/ports";

/** Records what the gateway asks Supabase for, and answers with what the test sets. */
function fakeClient(answer: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null }) {
  const calls: [string, Record<string, unknown>][] = [];
  const upserts: { table: string; rows: unknown[]; options: unknown }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      const { data = null, error = null } = answer(fn, args);
      return { data, error };
    },
    from: (table: string) => ({
      upsert: async (rows: unknown[], options: unknown) => {
        upserts.push({ table, rows, options });
        return { error: null };
      },
    }),
  };
  return { client: client as never, calls, upserts };
}

const profile = (id: string, username: string, displayName = "") => ({ id, username, displayName });

describe("SupabaseSocial", () => {
  it("reads the overview's JSON into profiles, tallies and rooms", async () => {
    const { client, calls } = fakeClient(() => ({
      data: {
        me: profile("me", "me_lifts", "Me"),
        incoming: [profile("j", "jdawg")],
        outgoing: [],
        friends: [{ profile: profile("a", "alex", "Alex"), thisWeek: { weekStart: "2026-11-16", planned: 4, done: 3 }, streak: 5 }],
        invites: [{ roomId: "r2", roomName: "Leg day", invitedBy: profile("a", "alex", "Alex") }],
        rooms: [
          {
            id: "r1",
            name: "Gym bros",
            ownerId: "me",
            members: [
              { profile: profile("me", "me_lifts", "Me"), status: "joined", thisWeek: null, lastWeek: { weekStart: "2026-11-09", planned: 3, done: 3 }, streak: 1 },
              { profile: profile("a", "alex", "Alex"), status: "invited", thisWeek: null, lastWeek: null, streak: 0 },
            ],
          },
        ],
      },
    }));
    const social = new SupabaseSocial(client, () => "me");
    const o = await social.overview(LocalDate.parse("2026-11-16"), LocalDate.parse("2026-11-09"));
    expect(calls).toEqual([["gt_social_overview", { this_week: "2026-11-16", last_week: "2026-11-09" }]]);
    expect(o.me?.name).toBe("Me");
    expect(o.incoming.map((p) => p.name)).toEqual(["@jdawg"]);
    expect(o.friends.map((f) => [f.profile.name, f.thisWeek?.label, f.streak])).toEqual([["Alex", "3/4", 5]]);
    expect(o.invites.map((i) => [i.roomName, i.invitedBy?.name])).toEqual([["Leg day", "Alex"]]);
    expect([o.rooms[0]!.joined().length, o.rooms[0]!.invited().length, o.rooms[0]!.lastWeekWinners().map((m) => m.profile.id)]).toEqual([1, 1, ["me"]]);
  });

  it("calls each function with its argument names and reads friend-request answers", async () => {
    const { client, calls } = fakeClient((fn) => ({ data: fn === "gt_request_friend" ? "already_requested" : fn === "gt_create_room" ? "room-1" : true }));
    const social = new SupabaseSocial(client, () => "me");
    const sam = Username.trusted("sam_lifts");
    expect(await social.isUsernameFree(sam)).toBe(true);
    expect(await social.requestFriend(sam)).toBe("already-requested");
    await social.answerFriend("a", true);
    await social.unfriend("a");
    expect(await social.createRoom("Gym bros", ["a", "b"])).toBe("room-1");
    await social.invite("room-1", ["c"]);
    await social.answerInvite("room-1", false);
    await social.leaveRoom("room-1");
    expect(calls).toEqual([
      ["gt_username_available", { name: "sam_lifts" }],
      ["gt_request_friend", { name: "sam_lifts" }],
      ["gt_answer_friend", { other: "a", accept: true }],
      ["gt_unfriend", { other: "a" }],
      ["gt_create_room", { room_name: "Gym bros", invitees: ["a", "b"] }],
      ["gt_invite_to_room", { room: "room-1", invitees: ["c"] }],
      ["gt_answer_invite", { room: "room-1", accept: false }],
      ["gt_leave_room", { room: "room-1" }],
    ]);
  });

  it("publishes your own tallies into weekly_tallies, and needs you signed in", async () => {
    const { client, upserts } = fakeClient(() => ({}));
    const tallies = [WeekTally.of(LocalDate.parse("2026-11-16"), 4, 2), WeekTally.of(LocalDate.parse("2026-11-09"), 4, 4)];
    await new SupabaseSocial(client, () => "me").publishTallies(tallies, 3);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.table).toBe("weekly_tallies");
    expect(upserts[0]!.options).toEqual({ onConflict: "user_id,week_start" });
    expect((upserts[0]!.rows as Record<string, unknown>[]).map(({ updated_at: _, ...row }) => row)).toEqual([
      { user_id: "me", week_start: "2026-11-16", planned: 4, done: 2, streak: 3 },
      { user_id: "me", week_start: "2026-11-09", planned: 4, done: 4, streak: 3 },
    ]);
    await expect(new SupabaseSocial(client, () => null).publishTallies(tallies, 0)).rejects.toMatchObject({ problem: "signed-out" });
  });

  it("says what went wrong: tables not set up, taken usernames, not friends, offline", async () => {
    const problem = (message: string, code?: string) => SupabaseSocial.problem({ message, code }).problem;
    expect(problem("Could not find the function public.gt_social_overview(last_week, this_week) in the schema cache", "PGRST202")).toBe("not-set-up");
    expect(problem('relation "public.weekly_tallies" does not exist', "42P01")).toBe("not-set-up");
    expect(problem("username_taken", "P0001")).toBe("username-taken");
    expect(problem("not_friends", "P0001")).toBe("not-friends");
    expect(problem("signed_out", "P0001")).toBe("signed-out");
    expect(problem("TypeError: Failed to fetch")).toBe("offline");
    expect(problem("something else")).toBe("failed");

    const offline = new SupabaseSocial({ rpc: async () => Promise.reject(new TypeError("Load failed")) } as never, () => "me");
    await expect(offline.overview(LocalDate.parse("2026-11-16"), LocalDate.parse("2026-11-09"))).rejects.toEqual(expect.any(SocialError));
    await expect(offline.overview(LocalDate.parse("2026-11-16"), LocalDate.parse("2026-11-09"))).rejects.toMatchObject({ problem: "offline" });
  });
});
