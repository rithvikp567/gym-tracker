import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { MemorySocialServer } from "../src/data/MemorySocial";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { LocalDate } from "../src/domain/LocalDate";
import { Session } from "../src/domain/Session";
import { SetEntry } from "../src/domain/SetEntry";
import { Profile } from "../src/domain/social/Profile";
import { cleanRoomName, rankMembers, Room, type RoomMember } from "../src/domain/social/Room";
import { describeOutcome } from "../src/domain/social/SocialOverview";
import { isUsername, Username } from "../src/domain/social/Username";
import { streakOf, WeekTally } from "../src/domain/social/WeekTally";
import { Split } from "../src/domain/Split";
import { WorkoutDay } from "../src/domain/WorkoutDay";
import { Emitter } from "../src/lib/Emitter";
import { SocialError } from "../src/services/ports";
import { SetupService } from "../src/services/SetupService";
import { SessionService } from "../src/services/SessionService";
import { SocialService } from "../src/services/SocialService";

const d = (iso: string) => LocalDate.parse(iso);
const MON = d("2026-11-16"); // this week's Monday when today is Fri Nov 20

describe("Username", () => {
  it("takes any case and a leading @, and says what's wrong otherwise", () => {
    const ok = Username.parse("  @Sam_Lifts ");
    expect(isUsername(ok) && [ok.value, ok.handle]).toEqual(["sam_lifts", "@sam_lifts"]);
    expect(Username.parse("ab")).toEqual({ problem: "At least 3 characters." });
    expect(Username.parse("a".repeat(21))).toEqual({ problem: "At most 20 characters." });
    expect(Username.parse("sam.lifts")).toEqual({ problem: "Letters, numbers and _ only." });
    expect(Username.parse("sam lifts")).toEqual({ problem: "Letters, numbers and _ only." });
  });
});

describe("Profile", () => {
  it("shows the display name, or the handle without one, never anything else", () => {
    const sam = Profile.from({ id: "1", username: "sam_lifts", displayName: " Sam " });
    expect([sam.name, sam.initial, sam.displayName]).toEqual(["Sam", "S", "Sam"]);
    const bare = Profile.from({ id: "2", username: "jdawg", displayName: "" });
    expect([bare.name, bare.initial]).toEqual(["@jdawg", "J"]);
  });
});

describe("WeekTally and streaks", () => {
  it("scores done out of planned, capping extra workouts, and keeps a streak when every planned one is done", () => {
    const t = WeekTally.of(d("2026-11-18"), 4, 3);
    expect([t.weekStart.toString(), t.hit, t.ratio, t.met, t.label]).toEqual(["2026-11-16", 3, 0.75, false, "3/4"]);
    const extra = WeekTally.of(MON, 3, 5);
    expect([extra.hit, extra.ratio, extra.met, extra.label]).toEqual([3, 1, true, "3/3"]);
    // Nothing planned: one workout is the whole week; none isn't.
    expect([WeekTally.of(MON, 0, 1).ratio, WeekTally.of(MON, 0, 1).met, WeekTally.of(MON, 0, 0).met]).toEqual([1, true, false]);
    expect(WeekTally.count(MON, [{ planned: true, workedOut: true }, { planned: true, workedOut: false }, { planned: false, workedOut: true }]).label).toBe("2/2");
  });

  it("counts weeks back from last week, adding this week only once it's met", () => {
    const w = (planned: number, done: number) => WeekTally.of(MON, planned, done);
    expect(streakOf([w(4, 2), w(4, 4), w(3, 3), w(4, 3), w(4, 4)])).toBe(2); // this week in progress: doesn't break it
    expect(streakOf([w(4, 4), w(4, 4), w(4, 1)])).toBe(2);
    expect(streakOf([w(4, 1), w(4, 1)])).toBe(0);
    expect(streakOf([])).toBe(0);
  });
});

describe("Rooms", () => {
  const member = (name: string, thisWeek: [number, number] | null, streak = 0, lastWeek: [number, number] | null = null): RoomMember => ({
    profile: Profile.from({ id: name, username: name, displayName: name[0]!.toUpperCase() + name.slice(1) }),
    status: "joined",
    thisWeek: thisWeek && WeekTally.of(MON, ...thisWeek),
    lastWeek: lastWeek && WeekTally.of(MON.addDays(-7), ...lastWeek),
    streak,
  });

  it("ranks on share of planned workouts done, then workouts done, then streak; ties share a place; no score comes last", () => {
    const board = rankMembers(
      [member("cara", [4, 2]), member("ana", [3, 3]), member("bo", [3, 3]), member("dev", null), member("eli", [5, 5], 1)],
      (m) => m.thisWeek,
    );
    expect(board.map((s) => [s.member.profile.id, s.rank])).toEqual([["eli", 1], ["ana", 2], ["bo", 2], ["cara", 4], ["dev", 0]]);
  });

  it("puts only joined members on the board, names last week's winners, and finds your place", () => {
    const invited = { ...member("fin", [2, 2]), status: "invited" as const };
    const room = Room.from({ id: "r", name: "Gym bros", ownerId: "ana", members: [member("ana", [4, 3], 0, [4, 4]), member("bo", [4, 4], 0, [4, 4]), invited] });
    expect(room.board().map((s) => s.member.profile.id)).toEqual(["bo", "ana"]);
    expect(room.lastWeekWinners().map((m) => m.profile.id)).toEqual(["ana", "bo"]);
    expect([room.rankOf("ana"), room.rankOf("fin"), room.has("fin"), room.has("zed")]).toEqual([2, null, true, false]);
    expect(cleanRoomName("  Leg   day  ")).toBe("Leg day");
    expect(cleanRoomName("   ")).toBeNull();
  });

  it("says what a friend request did", () => {
    expect(describeOutcome("accepted", "@sam")).toBe("@sam had already asked. You're friends now.");
    expect(describeOutcome("not-found", "@sam")).toBe("Nobody goes by @sam.");
  });
});

describe("SocialService", () => {
  const clock = { now: () => new Date(2026, 10, 20, 12) }; // Fri Nov 20, 2026
  let server: MemorySocialServer;
  let signedIn: string | null;
  let repos: StoreRepositories;
  let social: SocialService;
  /** Another person's service on the same server, with their own (empty) device. */
  const asSomeone = (id: string) => new SocialService(server.as(() => id), new StoreRepositories(new MemoryRecordStore(), clock), clock);

  beforeEach(() => {
    server = new MemorySocialServer();
    signedIn = "me";
    repos = new StoreRepositories(new MemoryRecordStore(), clock);
    social = new SocialService(server.as(() => signedIn), repos, clock);
    server.addProfile("me", "me_lifts", "Me");
    server.addProfile("ana", "ana", "Ana");
    server.addProfile("bo", "bo_b", "");
  });

  /** Upper on Mondays and Lower on Wednesdays and Fridays; logs on the given dates. */
  async function myLog(dates: string[]) {
    const setup = new SetupService(repos);
    const sessions = new SessionService(repos);
    let upper = await setup.createDay("Upper");
    upper = (await setup.updateDay(upper.id, (x) => x.addExercise("Pulldown")))!;
    const lower = await setup.createDay("Lower");
    await setup.setPlanned(0, upper.id);
    await setup.setPlanned(2, lower.id);
    await setup.setPlanned(4, lower.id);
    for (const date of dates) {
      await sessions.saveLog(upper.id, d(date), ExerciseLog.empty(upper.activeExercises()[0]!.id).withSets([new SetEntry(150, 8)]).withNote("private"));
    }
  }

  it("works out your week's score and streak from your own log and split", async () => {
    // Last week (Nov 9–15) and the one before: all three planned workouts; this week: two so far.
    await myLog(["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-18"]);
    const mine = await social.myTallies();
    expect([mine.thisWeek.label, mine.lastWeek.label, mine.streak]).toEqual(["2/3", "3/3", 2]);
  });

  it("publishes your scores when the Social page loads, so friends and rooms see them", async () => {
    await myLog(["2026-11-16", "2026-11-18", "2026-11-20"]);
    server.befriend("me", "ana");
    await social.overview();
    const anaSees = await asSomeone("ana").overview();
    expect(anaSees.friends.map((f) => [f.profile.name, f.thisWeek?.label, f.streak])).toEqual([["Me", "3/3", 1]]);
  });

  it("adds friends by username, accepting when they'd already asked", async () => {
    const changed = vi.fn();
    social.changes.subscribe(changed);
    expect(await social.addFriend("b")).toEqual({ ok: false, message: "At least 3 characters." });
    expect(await social.addFriend("@nobody")).toEqual({ ok: false, message: "Nobody goes by @nobody." });
    expect(await social.addFriend("me_lifts")).toEqual({ ok: false, message: "That's you." });
    expect(await social.addFriend("@Ana")).toEqual({ ok: true, message: "Request sent to @ana." });
    expect(await social.addFriend("ana")).toEqual({ ok: false, message: "You already asked @ana." });
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await social.overview()).outgoing.map((p) => p.id)).toEqual(["ana"]);

    await asSomeone("bo").addFriend("me_lifts");
    expect((await social.overview()).incoming.map((p) => p.name)).toEqual(["@bo_b"]);
    expect(await social.addFriend("bo_b")).toEqual({ ok: true, message: "@bo_b had already asked. You're friends now." });
    expect((await social.overview()).friends.map((f) => f.profile.id)).toEqual(["bo"]);
  });

  it("answers requests, and takes them back or removes friends either way", async () => {
    await asSomeone("ana").addFriend("me_lifts");
    await asSomeone("bo").addFriend("me_lifts");
    await social.answerFriend("ana", true);
    await social.answerFriend("bo", false);
    let o = await social.overview();
    expect([o.friends.map((f) => f.profile.id), o.incoming]).toEqual([["ana"], []]);
    await social.unfriend("ana");
    o = await social.overview();
    expect(o.friends).toEqual([]);
  });

  it("shows a friend's week and latest workouts in their units, never their notes, and only to friends", async () => {
    let day = WorkoutDay.create("Push", 0).addExercise("Bench").addExercise("Leg press");
    const [bench, press] = day.activeExercises();
    day = day.withExercise(press!.withUnit("plates", "relabel"));
    const split = Split.empty().withWeekday(0, day.id).withWeekday(2, day.id);
    const log = (date: string, kg = false) =>
      Session.start(day.id, d(date))
        .withLog(ExerciseLog.empty(bench!.id).withSets([new SetEntry(kg ? 80 : 185, 6), new SetEntry(kg ? 80 : 185, 5)]).withUnit(kg ? "kg" : "lb").withNote("shoulder hurt"))
        .withLog(ExerciseLog.empty(press!.id).withSets([new SetEntry(2.5, 10)]).withUnit("plates"))
        .toJSON();
    server.setRecords("ana", { days: [day.toJSON()], split: split.toJSON(), sessions: [log("2026-11-09"), log("2026-11-16", true)] });

    await expect(social.friendDetail("ana")).rejects.toThrow(SocialError);
    server.befriend("ana", "me");
    const detail = await social.friendDetail("ana");
    expect(detail.week.map((x) => x.status)).toEqual(["done", "rest", "missed", "rest", "rest", "rest", "rest"]);
    expect(detail.recent.map((w) => [w.date.toString(), w.dayName, w.lines])).toEqual([
      ["2026-11-16", "Push", ["Bench 80 kg × 6/5", "Leg press 2.5 pl × 10"]],
      ["2026-11-09", "Push", ["Bench 185 × 6/5", "Leg press 2.5 pl × 10"]],
    ]);
    expect(JSON.stringify(detail)).not.toContain("shoulder");
  });

  it("creates rooms with friends only, invites more, and ranks everyone who joined", async () => {
    server.befriend("me", "ana");
    await myLog(["2026-11-16"]);
    expect(await social.createRoom("   ", [])).toEqual({ ok: false, message: "Give the room a name." });
    expect(await social.createRoom(" Gym  bros ", ["ana", "bo"])).toEqual({ ok: true, message: "Gym bros is ready." }); // bo isn't a friend
    const ana = asSomeone("ana");
    const [invite] = (await ana.overview()).invites;
    expect([invite?.roomName, invite?.invitedBy?.name]).toEqual(["Gym bros", "Me"]);
    server.setTally("ana", WeekTally.of(MON, 4, 4), 3);
    await ana.answerInvite(invite!.roomId, true);

    const [room] = (await social.overview()).rooms;
    expect(room!.board().map((s) => [s.member.profile.id, s.tally?.label, s.rank])).toEqual([["ana", "4/4", 1], ["me", "1/3", 2]]);
    expect((await asSomeone("bo").overview()).invites).toEqual([]);

    // Someone only invited shows no scores until they join, even to friends.
    server.befriend("me", "bo");
    server.setTally("bo", WeekTally.of(MON, 3, 3), 4);
    await social.invite(room!.id, ["bo"]);
    const bo = (await social.overview()).rooms[0]!.invited()[0]!;
    expect([bo.profile.id, bo.thisWeek, bo.streak]).toEqual(["bo", null, 0]);

    // The owner leaves: the room goes to whoever joined first (Ana), never to someone invited earlier.
    await asSomeone("bo").answerInvite(room!.id, true);
    await social.leaveRoom(room!.id);
    expect((await ana.overview()).rooms.map((r) => r.ownerId)).toEqual(["ana"]);
    await ana.leaveRoom(room!.id);
    expect((await asSomeone("bo").overview()).rooms.map((r) => r.ownerId)).toEqual(["bo"]);
    await asSomeone("bo").leaveRoom(room!.id);
    expect((await ana.overview()).rooms).toEqual([]);
  });

  it("checks usernames before claiming one", async () => {
    expect(await social.usernameProblem("x")).toBe("At least 3 characters.");
    expect(await social.usernameProblem("ana")).toBe("@ana is taken.");
    expect(await social.usernameProblem("new_name")).toBeNull();
    await expect(social.claimProfile("ana", "")).rejects.toMatchObject({ problem: "username-taken" });
    expect((await social.claimProfile("New_Name", "  Me  again ")).toJSON()).toEqual({ id: "me", username: "new_name", displayName: "Me again" });
  });

  describe("publishing on changes", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("publishes a while after your log changes, at once when you sign in, and never while signed out", async () => {
      const data = new Emitter();
      const account = new Emitter();
      const publish = vi.spyOn(social, "publish").mockResolvedValue();
      social.publishOnChanges(data, account, () => signedIn !== null, 8_000);
      data.emit();
      data.emit();
      await vi.advanceTimersByTimeAsync(7_999);
      expect(publish).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(publish).toHaveBeenCalledTimes(1);
      account.emit();
      await vi.advanceTimersByTimeAsync(0);
      expect(publish).toHaveBeenCalledTimes(2);
      signedIn = null;
      data.emit();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(publish).toHaveBeenCalledTimes(2);
    });
  });
});
