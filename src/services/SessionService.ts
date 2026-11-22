import { ExerciseLog } from "../domain/ExerciseLog";
import type { LocalDate } from "../domain/LocalDate";
import { Session } from "../domain/Session";
import type { Repositories } from "./ports";

export interface PastLog {
  date: LocalDate;
  log: ExerciseLog;
}

/** Logging a workout and moving through a workout day's history. */
export class SessionService {
  constructor(private readonly repos: Repositories) {}

  async find(workoutDayId: string, date: LocalDate): Promise<Session | undefined> {
    return this.repos.sessions.get(Session.idFor(workoutDayId, date));
  }

  /** The saved session, or a blank one (not saved until something is entered). */
  async open(workoutDayId: string, date: LocalDate): Promise<Session> {
    return (await this.find(workoutDayId, date)) ?? Session.start(workoutDayId, date);
  }

  /**
   * Saves one exercise's log into the session. A save for an exercise merged away or deleted on
   * this day (an editor still open when that synced in, saving as it closes) is dropped once the
   * session holds no log for it: SetupService.reconcile already filed that log, and writing it
   * again would file its sets twice. Until then it replaces that log, which reconcile files once.
   */
  async saveLog(workoutDayId: string, date: LocalDate, log: ExerciseLog): Promise<Session> {
    const [session, day] = await Promise.all([this.open(workoutDayId, date), this.repos.days.get(workoutDayId)]);
    if (day?.isRetired(log.exerciseId) && !session.log(log.exerciseId)) return session;
    return this.repos.sessions.save(session.withLog(log));
  }

  async delete(workoutDayId: string, date: LocalDate): Promise<void> {
    const session = await this.find(workoutDayId, date);
    if (session) await this.repos.sessions.save(session.markDeleted());
  }

  /** Sessions of this workout day with anything in them, oldest first. */
  async history(workoutDayId: string): Promise<Session[]> {
    return (await this.repos.sessions.forWorkoutDay(workoutDayId)).filter((s) => s.hasContent());
  }

  /** The last time this workout day was done before `date` (swipe right). */
  async previous(workoutDayId: string, date: LocalDate): Promise<Session | undefined> {
    const before = (await this.history(workoutDayId)).filter((s) => s.date.isBefore(date));
    return before.at(-1);
  }

  /** The next time after `date` (swipe left). */
  async next(workoutDayId: string, date: LocalDate): Promise<Session | undefined> {
    return (await this.history(workoutDayId)).find((s) => s.date.isAfter(date));
  }

  /** For each exercise, the most recent result before `date` ("last 130 · 8/8/7"). */
  async lastResultsBefore(workoutDayId: string, date: LocalDate): Promise<Map<string, PastLog>> {
    const out = new Map<string, PastLog>();
    const before = (await this.history(workoutDayId)).filter((s) => s.date.isBefore(date));
    for (let i = before.length - 1; i >= 0; i--) {
      const session = before[i]!;
      for (const log of session.logs) {
        if (!out.has(log.exerciseId) && log.hasResult()) out.set(log.exerciseId, { date: session.date, log });
      }
    }
    return out;
  }

  /** For each workout day, the last date it was done on or before `date` ("last Oct 12"). */
  async lastWorkoutDates(date: LocalDate): Promise<Map<string, LocalDate>> {
    const out = new Map<string, LocalDate>();
    // Oldest first, so later sessions overwrite earlier ones.
    for (const s of await this.repos.sessions.all()) {
      if (s.isWorkout() && !s.date.isAfter(date)) out.set(s.workoutDayId, s.date);
    }
    return out;
  }

  /** Everything logged on a date (calendar tap). */
  async onDate(date: LocalDate): Promise<Session[]> {
    return (await this.repos.sessions.onDate(date)).filter((s) => s.hasContent());
  }
}
