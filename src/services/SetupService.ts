import type { Weekday } from "../domain/LocalDate";
import type { Split } from "../domain/Split";
import { WorkoutDay } from "../domain/WorkoutDay";
import type { Repositories } from "./ports";

/** Creating and editing workout days, their exercises, and the weekly split. */
export class SetupService {
  constructor(private readonly repos: Repositories) {}

  days(): Promise<WorkoutDay[]> {
    return this.repos.days.all();
  }

  split(): Promise<Split> {
    return this.repos.split.get();
  }

  async createDay(name: string): Promise<WorkoutDay> {
    const days = await this.days();
    const order = days.length ? Math.max(...days.map((d) => d.order)) + 1 : 0;
    return this.repos.days.save(WorkoutDay.create(name, order));
  }

  /** Applies an edit (rename, add/move/archive exercise…) to a day and saves it. */
  async updateDay(id: string, edit: (day: WorkoutDay) => WorkoutDay): Promise<WorkoutDay | undefined> {
    const day = await this.repos.days.get(id);
    if (!day) return undefined;
    return this.repos.days.save(edit(day));
  }

  async deleteDay(id: string): Promise<void> {
    const day = await this.repos.days.get(id);
    if (!day) return;
    await this.repos.days.save(day.markDeleted());
    const split = await this.split();
    if (split.pattern.includes(id)) await this.repos.split.save(split.without(id));
  }

  async moveDay(id: string, delta: -1 | 1): Promise<void> {
    const days = await this.days();
    const from = days.findIndex((d) => d.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= days.length) return;
    const reordered = [...days];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);
    await this.repos.days.saveMany(reordered.flatMap((d, i) => (d.order === i ? [] : [d.withOrder(i)])));
  }

  async setPlanned(weekday: Weekday, workoutDayId: string | null): Promise<void> {
    const split = await this.split();
    await this.repos.split.save(split.withWeekday(weekday, workoutDayId));
  }

  /** How many sessions of the day have something logged for each exercise. */
  async usage(dayId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const session of await this.repos.sessions.forWorkoutDay(dayId)) {
      for (const log of session.logs) {
        if (log.hasContent()) counts.set(log.exerciseId, (counts.get(log.exerciseId) ?? 0) + 1);
      }
    }
    return counts;
  }

  /**
   * Folds `fromId` into `intoId` on a day (e.g. three spellings of leg press into one): every
   * session's log moves over (combined when both were logged that day) and `fromId` goes away.
   */
  async mergeExercise(dayId: string, fromId: string, intoId: string): Promise<void> {
    const day = await this.repos.days.get(dayId);
    if (!day || fromId === intoId || !day.exercise(fromId) || !day.exercise(intoId)) return;
    const affected = (await this.repos.sessions.forWorkoutDay(dayId)).filter((s) => s.log(fromId));
    await this.repos.sessions.saveMany(affected.map((s) => s.mergeLogs(fromId, intoId)));
    await this.repos.days.save(day.mergeExercise(fromId, intoId));
  }

  /** Deletes an exercise and everything logged for it. Sessions left with nothing are deleted too. */
  async deleteExercise(dayId: string, exerciseId: string): Promise<void> {
    const day = await this.repos.days.get(dayId);
    if (!day?.exercise(exerciseId)) return;
    const affected = (await this.repos.sessions.forWorkoutDay(dayId)).filter((s) => s.log(exerciseId));
    await this.repos.sessions.saveMany(
      affected.map((s) => {
        const without = s.withoutLog(exerciseId);
        return without.hasContent() ? without : without.markDeleted();
      }),
    );
    await this.repos.days.save(day.removeExercise(exerciseId));
  }
}
