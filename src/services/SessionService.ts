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

  async saveLog(workoutDayId: string, date: LocalDate, log: ExerciseLog): Promise<Session> {
    const session = await this.open(workoutDayId, date);
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

  /** Everything logged on a date (calendar tap). */
  async onDate(date: LocalDate): Promise<Session[]> {
    return (await this.repos.sessions.onDate(date)).filter((s) => s.hasContent());
  }
}
