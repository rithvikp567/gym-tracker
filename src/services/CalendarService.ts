import { dayStatus, type DayStatus } from "../domain/DayStatus";
import { LocalDate } from "../domain/LocalDate";
import type { Session } from "../domain/Session";
import type { Split } from "../domain/Split";
import type { WorkoutDay } from "../domain/WorkoutDay";
import type { Clock, Repositories } from "./ports";

export interface CalendarDay {
  date: LocalDate;
  status: DayStatus;
  plannedDayId: string | null;
  sessions: Session[];
}

/**
 * Where stepping to a date lands (the day arrows on a workout screen): that day's workout, or
 * a list to pick from (a rest day, or several workouts logged).
 */
export type DayTarget = { kind: "workout"; dayId: string } | { kind: "pick" };

/** Green/red dots for the calendar and the home week strip. */
export class CalendarService {
  constructor(private readonly repos: Repositories, private readonly clock: Clock) {}

  today(): LocalDate {
    return LocalDate.today(this.clock.now());
  }

  /** Every day from `from` to `to` inclusive. */
  async range(from: LocalDate, to: LocalDate): Promise<CalendarDay[]> {
    const [sessions, split] = await Promise.all([this.repos.sessions.all(), this.repos.split.get()]);
    return CalendarService.build(from, to, sessions, split, this.today());
  }

  async week(anchor: LocalDate): Promise<CalendarDay[]> {
    const start = anchor.startOfWeek();
    return this.range(start, start.addDays(6));
  }

  async year(year: number): Promise<CalendarDay[]> {
    return this.range(LocalDate.of(year, 1, 1), LocalDate.of(year, 12, 31));
  }

  /** What the day arrows open for `date`, staying on `currentDayId` when it was done that day. */
  async dayTarget(date: LocalDate, currentDayId: string | null): Promise<DayTarget> {
    const [sessions, split, days] = await Promise.all([this.repos.sessions.onDate(date), this.repos.split.get(), this.repos.days.all()]);
    return CalendarService.target(date, sessions, split, days, currentDayId);
  }

  /**
   * Pure core of `dayTarget`:
   *  1. the current workout, if it was logged that day;
   *  2. the only workout logged that day;
   *  3. several logged: the planned one if it's among them, otherwise pick;
   *  4. nothing logged: the planned workout, otherwise pick (a rest day).
   */
  static target(date: LocalDate, sessionsOnDate: Session[], split: Split, days: WorkoutDay[], currentDayId: string | null): DayTarget {
    const order = new Map(days.map((d, i) => [d.id, i]));
    const logged = sessionsOnDate
      .filter((s) => s.isoDate === date.toString() && s.hasContent() && order.has(s.workoutDayId))
      .map((s) => s.workoutDayId)
      .sort((a, b) => order.get(a)! - order.get(b)!);
    const plannedId = split.plannedFor(date);
    const planned = plannedId !== null && order.has(plannedId) ? plannedId : null;
    const workout = (dayId: string): DayTarget => ({ kind: "workout", dayId });

    if (currentDayId && logged.includes(currentDayId)) return workout(currentDayId);
    if (logged.length === 1) return workout(logged[0]!);
    if (logged.length > 1) return planned && logged.includes(planned) ? workout(planned) : { kind: "pick" };
    return planned ? workout(planned) : { kind: "pick" };
  }

  /** Pure core, unit-tested directly. */
  static build(from: LocalDate, to: LocalDate, sessions: Session[], split: Split, today: LocalDate): CalendarDay[] {
    const byDate = new Map<string, Session[]>();
    let trackingStart: LocalDate | null = null;
    for (const s of sessions) {
      if (!s.hasContent()) continue;
      const list = byDate.get(s.isoDate) ?? [];
      list.push(s);
      byDate.set(s.isoDate, list);
      if (s.isWorkout() && (trackingStart === null || s.date.isBefore(trackingStart))) trackingStart = s.date;
    }
    const days: CalendarDay[] = [];
    for (let d = from; !d.isAfter(to); d = d.addDays(1)) {
      const daySessions = byDate.get(d.toString()) ?? [];
      const plannedDayId = split.plannedFor(d);
      days.push({
        date: d,
        plannedDayId,
        sessions: daySessions,
        status: dayStatus({
          date: d,
          today,
          planned: plannedDayId !== null,
          workedOut: daySessions.some((s) => s.isWorkout()),
          trackingStart,
        }),
      });
    }
    return days;
  }
}
