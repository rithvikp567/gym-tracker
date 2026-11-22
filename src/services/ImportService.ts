import { Exercise } from "../domain/Exercise";
import { ExerciseLog } from "../domain/ExerciseLog";
import { LocalDate, type Weekday } from "../domain/LocalDate";
import { Session } from "../domain/Session";
import { WorkoutDay } from "../domain/WorkoutDay";
import type { ImportedLog, ImportPlan } from "./ImportPlan";
import type { Repositories } from "./ports";

export interface ImportResult {
  daysCreated: number;
  exercisesCreated: number;
  sessionsWritten: number;
}

/**
 * Writes an ImportPlan into storage. Safe to run again: days match by name, exercises by
 * name key, and sessions by (day, date), so re-importing updates instead of duplicating.
 * Rows are read in the unit their name was logged in (Exercise.unitOf), so a unit switch or a
 * merge across units holds up when the sheet comes in again.
 */
export class ImportService {
  constructor(private readonly repos: Repositories) {}

  async apply(plan: ImportPlan): Promise<ImportResult> {
    const existing = await this.repos.days.all();
    let nextOrder = existing.length ? Math.max(...existing.map((d) => d.order)) + 1 : 0;
    let daysCreated = 0;
    let exercisesCreated = 0;
    const savedDays: WorkoutDay[] = [];
    const sessions: Session[] = [];
    const dayIdByName = new Map<string, string>();

    for (const imported of plan.days) {
      let day = existing.find((d) => d.name.toLowerCase() === imported.name.toLowerCase());
      if (!day) {
        day = WorkoutDay.create(imported.name, nextOrder++);
        daysCreated++;
      }
      for (const ex of imported.exercises) {
        if (day.exerciseByKey(ex.key)) continue;
        day = day.withExercise(
          Exercise.create(ex.name, ex.kind).with({
            targetSets: ex.targetSets,
            targetText: ex.targetText,
            archived: !ex.active,
          }),
        );
        exercisesCreated++;
      }
      savedDays.push(day);
      dayIdByName.set(imported.name, day.id);

      // Rows that land on one exercise on one date (an exercise and one merged into it) combine
      // into one log: its own names' rows first, then merged names in the order they were merged
      // (Exercise.rowOrder), as SetupService.mergeExercise combines them. Each row is read in its
      // name's unit.
      const rowsByDate = new Map<string, { exercise: Exercise; row: ImportedLog }[]>();
      for (const s of imported.sessions) {
        const rows = rowsByDate.get(s.date) ?? [];
        for (const row of s.logs) {
          const exercise = day.exerciseByKey(row.key);
          if (exercise) rows.push({ exercise, row });
        }
        rowsByDate.set(s.date, rows);
      }
      for (const [date, rows] of rowsByDate) {
        let session = Session.start(day.id, LocalDate.parse(date));
        for (const { exercise, row } of rows.sort((a, b) => a.exercise.rowOrder(a.row.key) - b.exercise.rowOrder(b.row.key))) {
          const unit = exercise.unitOf(row.key);
          const log = ExerciseLog.from({ exerciseId: exercise.id, sets: row.sets, done: row.done, note: row.note });
          // Only weights have a unit: a row without any (a note alone) follows the exercise, as
          // Session.mergeLogs files it, so weights typed into it later are in the exercise's unit.
          const incoming = log.withUnit(unit === exercise.unit || log.topWeight() === null ? undefined : unit);
          const prev = session.log(exercise.id);
          session = session.withLog(prev ? prev.mergedWith(incoming, exercise.unit) : incoming);
        }
        if (session.hasContent()) sessions.push(session);
      }
    }

    await this.repos.days.saveMany(savedDays);
    await this.repos.sessions.saveMany(sessions);

    const split = await this.repos.split.get();
    if (!split.hasAnyPlan()) {
      let next = split;
      plan.split.forEach((name, weekday) => {
        const id = name ? dayIdByName.get(name) : undefined;
        if (id) next = next.withWeekday(weekday as Weekday, id);
      });
      if (next.hasAnyPlan()) await this.repos.split.save(next);
    }

    return { daysCreated, exercisesCreated, sessionsWritten: sessions.length };
  }
}
