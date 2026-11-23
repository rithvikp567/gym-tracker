import { LocalDate } from "../LocalDate";

export interface WeekTallyData {
  /** Monday of the week, ISO date. */
  weekStart: string;
  /** Days with a workout planned that week (the split). */
  planned: number;
  /** Days a workout was logged that week, planned or not. */
  done: number;
}

/** One day as a week tally counts it. */
export interface TallyDay {
  planned: boolean;
  workedOut: boolean;
}

/**
 * A week's score for friends and rooms: workouts done out of workouts planned, "3/4". Done is
 * capped at planned when ranking (`hit`), so a workout moved to another day still counts and an
 * extra one doesn't put you past someone who hit every planned day (D53).
 */
export class WeekTally {
  private constructor(
    readonly weekStart: LocalDate,
    readonly planned: number,
    readonly done: number,
  ) {}

  static of(weekStart: LocalDate, planned: number, done: number): WeekTally {
    const clamp = (n: number) => Math.max(0, Math.min(7, Math.round(n)));
    return new WeekTally(weekStart.startOfWeek(), clamp(planned), clamp(done));
  }

  static from(data: WeekTallyData): WeekTally {
    return WeekTally.of(LocalDate.parse(data.weekStart), data.planned, data.done);
  }

  /** Counts a week's days (Monday first; any number of them). */
  static count(weekStart: LocalDate, days: readonly TallyDay[]): WeekTally {
    return WeekTally.of(
      weekStart,
      days.filter((d) => d.planned).length,
      days.filter((d) => d.workedOut).length,
    );
  }

  /** Planned workouts done: done, at most planned. */
  get hit(): number {
    return Math.min(this.done, this.planned);
  }

  /** 0–1, for ranking. With nothing planned, any workout counts as the whole week. */
  get ratio(): number {
    if (this.planned === 0) return this.done > 0 ? 1 : 0;
    return this.hit / this.planned;
  }

  /** Every planned workout done (at least one when nothing was planned): the week keeps a streak going. */
  get met(): boolean {
    return this.done >= Math.max(this.planned, 1);
  }

  /** "3/4" */
  get label(): string {
    return `${this.hit}/${this.planned}`;
  }

  toJSON(): WeekTallyData {
    return { weekStart: this.weekStart.toString(), planned: this.planned, done: this.done };
  }
}

/**
 * Weeks in a row with every planned workout done, counting back from last week. This week adds
 * one once it's met; until then it's still in progress and doesn't break the streak.
 * `weeks` is newest first, one per week, starting with this week.
 */
export function streakOf(weeks: readonly WeekTally[]): number {
  const [thisWeek, ...earlier] = weeks;
  if (!thisWeek) return 0;
  let streak = thisWeek.met ? 1 : 0;
  for (const week of earlier) {
    if (!week.met) break;
    streak += 1;
  }
  return streak;
}
