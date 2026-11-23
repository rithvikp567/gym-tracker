import type { PastUnits } from "../domain/Exercise";
import type { LoadUnit, WeightUnit } from "../domain/Load";
import type { Weekday } from "../domain/LocalDate";
import type { Session } from "../domain/Session";
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

  /**
   * Moves a day to `index` in the list (dragged there), clamped to the list. Every day is
   * renumbered 0, 1, 2… in its new place, but only the days whose `order` changed are saved.
   */
  async moveDayTo(id: string, index: number): Promise<void> {
    const days = await this.days();
    const from = days.findIndex((d) => d.id === id);
    if (from < 0 || !Number.isFinite(index)) return;
    const to = Math.max(0, Math.min(days.length - 1, Math.trunc(index)));
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
   * Sessions with weights logged for the exercise in `unit` (a log saved without a unit counts in
   * the exercise's `bareUnit`): what switching the exercise away from `unit` asks about.
   */
  async sessionsLoggedIn(dayId: string, exerciseId: string, unit: LoadUnit): Promise<number> {
    const exercise = (await this.repos.days.get(dayId))?.exercise(exerciseId);
    if (!exercise) return 0;
    const sessions = await this.repos.sessions.forWorkoutDay(dayId);
    return sessions.filter((s) => {
      const log = s.log(exerciseId);
      return log !== undefined && log.topWeight() !== null && log.unitOr(exercise.bareUnit) === unit;
    }).length;
  }

  /**
   * Logs an exercise in `unit` from now on. `past` says what its weights saved in the old unit
   * are: "keep" leaves them in the old unit, "relabel" says they were in the new unit all along
   * (also fixes an earlier wrong choice). Nothing is converted. The choice is kept where a stale
   * copy can't undo it alone: "keep" on the exercise only (logs saved without a unit read in its
   * `bareUnit`, so a session re-saved by a device that hasn't heard of the switch still reads
   * right), "relabel" on the exercise and on every weighted log that read in the old unit (so a
   * stale copy of either the day or a session still reads right). Re-imported sheet rows follow
   * through the exercise (Exercise.withUnit).
   */
  async setUnit(dayId: string, exerciseId: string, unit: LoadUnit, past: PastUnits): Promise<void> {
    const day = await this.repos.days.get(dayId);
    const exercise = day?.exercise(exerciseId);
    if (!day || !exercise || exercise.unit === unit) return;
    const old = exercise.unit;
    const relabeled =
      past === "keep"
        ? []
        : (await this.repos.sessions.forWorkoutDay(dayId)).flatMap((s) => {
            const log = s.log(exerciseId);
            return log && log.topWeight() !== null && log.unitOr(exercise.bareUnit) === old ? [s.withLog(log.withUnit(unit))] : [];
          });
    await this.repos.sessions.saveMany(relabeled);
    await this.repos.days.save(day.withExercise(exercise.withUnit(unit, past)));
  }

  /**
   * The kg / lb switch while logging: weights are typed in `unit` from this exercise down
   * (WorkoutDay.withWeightUnitFrom). Saved on the workout day, so it follows you to your other
   * devices and the next session opens in it. Nothing logged is converted or relabeled here.
   */
  async setWeightUnitFrom(dayId: string, exerciseId: string, unit: WeightUnit): Promise<void> {
    const day = await this.repos.days.get(dayId);
    if (!day) return;
    const next = day.withWeightUnitFrom(exerciseId, unit);
    if (next !== day) await this.repos.days.save(next);
  }

  /**
   * Folds `fromId` into `intoId` on a day (e.g. three spellings of leg press into one): every
   * session's log moves over (combined when both were logged that day) and `fromId` goes away.
   * Moved logs keep their unit; a day logged in both units is combined in pounds.
   */
  async mergeExercise(dayId: string, fromId: string, intoId: string): Promise<void> {
    const day = await this.repos.days.get(dayId);
    const from = day?.exercise(fromId);
    const into = day?.exercise(intoId);
    if (!day || !from || !into || fromId === intoId) return;
    const units = { from: from.bareUnit, into: into.bareUnit };
    const affected = (await this.repos.sessions.forWorkoutDay(dayId)).filter((s) => s.log(fromId));
    await this.repos.sessions.saveMany(affected.map((s) => s.mergeLogs(fromId, intoId, units)));
    await this.repos.days.save(day.mergeExercise(fromId, intoId));
  }

  /** Deletes an exercise and everything logged for it. Sessions left with nothing are deleted too. */
  async deleteExercise(dayId: string, exerciseId: string): Promise<void> {
    const day = await this.repos.days.get(dayId);
    if (!day?.exercise(exerciseId)) return;
    const affected = (await this.repos.sessions.forWorkoutDay(dayId)).filter((s) => s.log(exerciseId));
    await this.repos.sessions.saveMany(affected.map((s) => SetupService.keepIfAny(s.withoutLog(exerciseId))));
    await this.repos.days.save(day.removeExercise(exerciseId));
  }

  /**
   * Files logs that synced in for exercises merged or deleted on another device (saved there
   * before it heard): into the exercise they were merged into, or dropped with the exercise.
   * Safe to run any time and as often as you like; returns how many sessions it fixed. Fixes are
   * dated just after the copy they fixed (saveRepairs), so they never beat a newer edit of that
   * session still on its way from another device. A session saved or synced in while a round
   * ran is left alone by that round (saveRepairs) and repaired from its new copy by the next.
   */
  async reconcile(): Promise<number> {
    let fixed = 0;
    for (let round = 0; round < 3; round++) {
      const { found, saved } = await this.reconcileOnce();
      fixed += saved;
      if (saved === found) break;
    }
    return fixed;
  }

  private async reconcileOnce(): Promise<{ found: number; saved: number }> {
    const days = (await this.repos.days.all()).filter((d) => d.retiredExercises().length > 0);
    if (!days.length) return { found: 0, saved: 0 };
    const sessions = await this.repos.sessions.all();
    const fixed: Session[] = [];
    for (const day of days) {
      for (const session of sessions.filter((s) => s.workoutDayId === day.id)) {
        let next = session;
        for (const log of session.logs) {
          const fate = day.retiredFate(log.exerciseId);
          if (!fate) continue;
          next =
            fate.kind === "drop"
              ? next.withoutLog(log.exerciseId)
              : next.mergeLogs(log.exerciseId, fate.into.id, { from: fate.unit, into: fate.into.bareUnit });
        }
        if (next !== session) fixed.push(SetupService.keepIfAny(next));
      }
    }
    return { found: fixed.length, saved: await this.repos.sessions.saveRepairs(fixed) };
  }

  /** A session that lost its last log is deleted rather than kept empty. */
  private static keepIfAny(session: Session): Session {
    return session.hasContent() ? session : session.markDeleted();
  }
}
