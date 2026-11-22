import type { Exercise } from "../domain/Exercise";
import { formatLoad, platesToPounds } from "../domain/Load";
import { LocalDate } from "../domain/LocalDate";
import { formatNumber } from "../domain/SetEntry";
import type { Session } from "../domain/Session";
import type { WorkoutDay } from "../domain/WorkoutDay";
import type { Clock, Repositories } from "./ports";

export type RangeKey = "1W" | "1M" | "6M" | "1Y" | "ALL";

export const RANGES: readonly { key: RangeKey; label: string }[] = [
  { key: "1W", label: "Week" },
  { key: "1M", label: "Month" },
  { key: "6M", label: "6M" },
  { key: "1Y", label: "Year" },
  { key: "ALL", label: "All" },
];

export interface ProgressPoint {
  date: LocalDate;
  /** Heaviest set that session, in pounds (plates are converted so every line shares one axis). */
  weight: number;
  /** The heaviest set as logged: "135", or "2.5 pl" for plates. */
  label: string;
  /** "135 · 8/8/7" for the tooltip; plates add the pounds: "2.5 pl (230 lb) · 8/8". */
  summary: string;
}

export interface ProgressLine {
  exercise: Exercise;
  points: ProgressPoint[];
}

export interface ProgressData {
  from: LocalDate | null;
  to: LocalDate;
  lines: ProgressLine[];
}

/** Weight-over-time lines for each exercise of a workout day. */
export class ProgressService {
  constructor(private readonly repos: Repositories, private readonly clock: Clock) {}

  async lines(workoutDayId: string, range: RangeKey): Promise<ProgressData> {
    const [day, sessions] = await Promise.all([
      this.repos.days.get(workoutDayId),
      this.repos.sessions.forWorkoutDay(workoutDayId),
    ]);
    const today = LocalDate.today(this.clock.now());
    if (!day) return { from: ProgressService.rangeStart(range, today), to: today, lines: [] };
    return ProgressService.build(day, sessions, range, today);
  }

  static rangeStart(range: RangeKey, today: LocalDate): LocalDate | null {
    switch (range) {
      case "1W": return today.addDays(-6);
      case "1M": return today.addMonths(-1);
      case "6M": return today.addMonths(-6);
      case "1Y": return today.addMonths(-12);
      case "ALL": return null;
    }
  }

  /** Pure core: active exercises first (in day order), then archived ones that have data. */
  static build(day: WorkoutDay, sessions: Session[], range: RangeKey, today: LocalDate): ProgressData {
    const from = ProgressService.rangeStart(range, today);
    const inRange = sessions.filter((s) => (!from || !s.date.isBefore(from)) && !s.date.isAfter(today));
    const ordered = [...day.activeExercises(), ...day.allExercises().filter((e) => e.archived)];
    const lines: ProgressLine[] = [];
    for (const exercise of ordered) {
      if (exercise.kind !== "strength") continue;
      const points: ProgressPoint[] = [];
      for (const s of inRange) {
        const log = s.log(exercise.id);
        const top = log?.topWeight() ?? null;
        if (!log || top === null) continue;
        // Each session in the unit it was saved in, so a unit switch doesn't rewrite history.
        const unit = log.unitOr(exercise.unit);
        if (unit === "plates") {
          const pounds = platesToPounds(top);
          const reps = log.repsLabel();
          const summary = `${log.weightLabel(unit)} (${formatNumber(pounds)} lb)${reps ? ` · ${reps}` : ""}`;
          points.push({ date: s.date, weight: pounds, label: formatLoad(top, "plates"), summary });
        } else {
          points.push({ date: s.date, weight: top, label: formatLoad(top, "lb"), summary: log.summary(" · ", unit) });
        }
      }
      if (points.length) lines.push({ exercise, points });
    }
    return { from, to: today, lines };
  }
}
