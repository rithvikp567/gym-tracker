import { dayStatus, type DayStatus } from "../domain/DayStatus";
import { LocalDate } from "../domain/LocalDate";
import type { Session } from "../domain/Session";
import type { Split } from "../domain/Split";
import type { Clock, Repositories } from "./ports";

export interface CalendarDay {
  date: LocalDate;
  status: DayStatus;
  plannedDayId: string | null;
  sessions: Session[];
}

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
