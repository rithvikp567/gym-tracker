import { LocalDate } from "../domain/LocalDate";
import { Session, type SessionData } from "../domain/Session";
import { cleanDisplayName, type Profile } from "../domain/social/Profile";
import { cleanRoomName } from "../domain/social/Room";
import { describeOutcome, type SocialOverview } from "../domain/social/SocialOverview";
import { isUsername, Username } from "../domain/social/Username";
import { streakOf, WeekTally } from "../domain/social/WeekTally";
import { Split } from "../domain/Split";
import { WorkoutDay, type WorkoutDayData } from "../domain/WorkoutDay";
import { Emitter, type Unsubscribe } from "../lib/Emitter";
import { CalendarService, type CalendarDay } from "./CalendarService";
import { SocialError, type ChangeFeed, type Clock, type Repositories, type SocialGateway } from "./ports";

/** How far back a streak is counted. */
const STREAK_WEEKS = 104;
/** A friend's page shows this week and their workouts from the weeks before. */
const FRIEND_WEEKS = 4;
const RECENT_WORKOUTS = 3;
/** Scores go up this long after the last change on this device (logging a set after set). */
const PUBLISH_DELAY_MS = 8_000;

/** Your own scores, worked out from what's logged on this device. */
export interface MyTallies {
  thisWeek: WeekTally;
  lastWeek: WeekTally;
  streak: number;
}

/** One of a friend's recent workouts, as their page lists it. */
export interface RecentWorkout {
  date: LocalDate;
  dayName: string;
  /** "Pulldown 185 × 6/6", "Leg press 2.5 pl × 10", "Walk Done". */
  lines: string[];
}

/** A friend's page: their week as dots and their latest workouts (no notes: the server removes them). */
export interface FriendDetail {
  week: CalendarDay[];
  recent: RecentWorkout[];
}

/** What a friend-request or form action did, as one line to show. */
export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Friends and rooms (TASKS.md D53). Screens talk to this, never to the gateway: it parses what
 * people type, works out your weekly scores from your own log, publishes them, and turns a
 * friend's records into their week and recent workouts with the same calendar rules as yours.
 * `changes` fires after anything that changes what the Social page shows.
 */
export class SocialService {
  private readonly emitter = new Emitter();
  /** Fires after an action here changes the Social page (a request, a room…), or on `refresh()`. */
  readonly changes: ChangeFeed = { subscribe: (listener) => this.emitter.subscribe(listener) };

  constructor(
    private readonly gateway: SocialGateway,
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  get available(): boolean {
    return this.gateway.available;
  }

  /** Reloads what the Social page shows (coming back to the app, pulling to refresh). */
  refresh(): void {
    this.emitter.emit();
  }

  /** The Social page. Your scores go up first, so they're never older than what you're looking at. */
  async overview(): Promise<SocialOverview> {
    await this.publish().catch((e: unknown) => {
      if (!(e instanceof SocialError)) throw e;
      if (e.problem === "not-set-up" || e.problem === "offline" || e.problem === "signed-out") throw e;
      console.warn("Couldn't publish weekly scores", e);
    });
    const thisWeek = this.today().startOfWeek();
    return this.gateway.overview(thisWeek, thisWeek.addDays(-7));
  }

  // ───── Profile ─────

  /** Whether a typed username can be had: a sentence when it can't, null when it's free. */
  async usernameProblem(raw: string): Promise<string | null> {
    const parsed = Username.parse(raw);
    if (!isUsername(parsed)) return parsed.problem;
    return (await this.gateway.isUsernameFree(parsed)) ? null : `${parsed.handle} is taken.`;
  }

  async claimProfile(rawUsername: string, rawDisplayName: string): Promise<Profile> {
    const parsed = Username.parse(rawUsername);
    if (!isUsername(parsed)) throw new SocialError("failed", parsed.problem);
    const profile = await this.gateway.claimProfile(parsed, cleanDisplayName(rawDisplayName));
    this.emitter.emit();
    return profile;
  }

  // ───── Friends ─────

  async addFriend(raw: string): Promise<ActionResult> {
    const parsed = Username.parse(raw);
    if (!isUsername(parsed)) return { ok: false, message: parsed.problem };
    const outcome = await this.gateway.requestFriend(parsed);
    const ok = outcome === "sent" || outcome === "accepted";
    if (ok) this.emitter.emit();
    return { ok, message: describeOutcome(outcome, parsed.handle) };
  }

  async answerFriend(fromId: string, accept: boolean): Promise<void> {
    await this.gateway.answerFriend(fromId, accept);
    this.emitter.emit();
  }

  /** Removes a friend or takes back a request. */
  async unfriend(otherId: string): Promise<void> {
    await this.gateway.unfriend(otherId);
    this.emitter.emit();
  }

  /** A friend's week and latest workouts, read with the same calendar rules as your own. */
  async friendDetail(friendId: string): Promise<FriendDetail> {
    const today = this.today();
    const weekStart = today.startOfWeek();
    const records = await this.gateway.friendRecords(friendId, weekStart.addDays(-7 * (FRIEND_WEEKS - 1)));
    const days = parseAll(records.days, (d: WorkoutDayData) => WorkoutDay.from(d));
    const sessions = parseAll(records.sessions, (s: SessionData) => Session.from(s)).filter((s) => !s.deleted);
    const split = records.split ? Split.from(records.split) : Split.empty();
    const week = CalendarService.build(weekStart, weekStart.addDays(6), sessions, split, today);
    return { week, recent: SocialService.recentWorkouts(days, sessions) };
  }

  /** Pure core of a friend's latest workouts: newest first, each exercise's numbers in the unit logged. */
  static recentWorkouts(days: readonly WorkoutDay[], sessions: readonly Session[]): RecentWorkout[] {
    const byId = new Map(days.map((d) => [d.id, d]));
    return sessions
      .filter((s) => s.isWorkout())
      .sort((a, b) => b.date.compare(a.date))
      .slice(0, RECENT_WORKOUTS)
      .map((s) => {
        const day = byId.get(s.workoutDayId);
        const lines = s.logs
          .filter((log) => log.hasResult() || log.done === false)
          .map((log) => {
            const exercise = day?.exercise(log.exerciseId);
            return `${exercise?.name ?? "Exercise"} ${log.summary(" × ", exercise?.bareUnit ?? "lb")}`;
          });
        return { date: s.date, dayName: day?.name ?? "Workout", lines };
      });
  }

  // ───── Rooms ─────

  async createRoom(rawName: string, inviteIds: readonly string[]): Promise<ActionResult> {
    const name = cleanRoomName(rawName);
    if (!name) return { ok: false, message: "Give the room a name." };
    await this.gateway.createRoom(name, inviteIds);
    this.emitter.emit();
    return { ok: true, message: `${name} is ready.` };
  }

  async invite(roomId: string, inviteIds: readonly string[]): Promise<void> {
    if (!inviteIds.length) return;
    await this.gateway.invite(roomId, inviteIds);
    this.emitter.emit();
  }

  async answerInvite(roomId: string, accept: boolean): Promise<void> {
    await this.gateway.answerInvite(roomId, accept);
    this.emitter.emit();
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.gateway.leaveRoom(roomId);
    this.emitter.emit();
  }

  // ───── Your scores ─────

  /** This week's and last week's tallies and your streak, from your own log and split. */
  async myTallies(): Promise<MyTallies> {
    const [sessions, split] = await Promise.all([this.repos.sessions.all(), this.repos.split.get()]);
    return SocialService.tallies(sessions, split, this.today());
  }

  /** Pure core of `myTallies`. */
  static tallies(sessions: readonly Session[], split: Split, today: LocalDate): MyTallies {
    const thisWeek = today.startOfWeek();
    const from = thisWeek.addDays(-7 * (STREAK_WEEKS - 1));
    const days = CalendarService.build(from, thisWeek.addDays(6), [...sessions], split, today);
    const weeks: WeekTally[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const week = days.slice(i, i + 7);
      weeks.push(
        WeekTally.count(
          week[0]!.date,
          week.map((d) => ({ planned: d.plannedDayId !== null, workedOut: d.sessions.some((s) => s.isWorkout()) })),
        ),
      );
    }
    weeks.reverse(); // newest first
    return { thisWeek: weeks[0]!, lastWeek: weeks[1]!, streak: streakOf(weeks) };
  }

  /** Puts your scores where friends and rooms can see them. */
  async publish(): Promise<void> {
    if (!this.gateway.available) return;
    const { thisWeek, lastWeek, streak } = await this.myTallies();
    await this.gateway.publishTallies([thisWeek, lastWeek], streak);
  }

  /**
   * Keeps your published scores current: a while after each change to your log, and when you
   * sign in. Failures only wait for the next change (or the Social page, which publishes too).
   */
  publishOnChanges(dataChanges: ChangeFeed, accountChanges: ChangeFeed, signedIn: () => boolean, delayMs = PUBLISH_DELAY_MS): Unsubscribe {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (wait: number) => {
      if (!this.gateway.available || !signedIn()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        this.publish().catch((e: unknown) => console.warn("Couldn't publish weekly scores", e));
      }, wait);
    };
    const stopData = dataChanges.subscribe(() => schedule(delayMs));
    const stopAccount = accountChanges.subscribe(() => schedule(0));
    return () => {
      if (timer) clearTimeout(timer);
      stopData();
      stopAccount();
    };
  }

  private today(): LocalDate {
    return LocalDate.today(this.clock.now());
  }
}

/** Parses records from another account, skipping any this version can't read. */
function parseAll<D, T>(records: readonly D[], parse: (data: D) => T): T[] {
  const out: T[] = [];
  for (const record of records) {
    try {
      out.push(parse(record));
    } catch (e) {
      console.warn("Skipped a friend's record this version can't read", e);
    }
  }
  return out;
}
