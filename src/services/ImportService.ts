import { Exercise } from "../domain/Exercise";
import { ExerciseLog } from "../domain/ExerciseLog";
import { LocalDate, type Weekday } from "../domain/LocalDate";
import { Session } from "../domain/Session";
import { WorkoutDay } from "../domain/WorkoutDay";
import type { ImportPlan } from "./ImportPlan";
import type { Repositories } from "./ports";

export interface ImportResult {
  daysCreated: number;
  exercisesCreated: number;
  sessionsWritten: number;
}

/**
 * Writes an ImportPlan into storage. Safe to run again: days match by name, exercises by
 * name key, and sessions by (day, date), so re-importing updates instead of duplicating.
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

      for (const s of imported.sessions) {
        let session = Session.start(day.id, LocalDate.parse(s.date));
        for (const log of s.logs) {
          const exercise = day.exerciseByKey(log.key);
          if (!exercise) continue;
          session = session.withLog(ExerciseLog.from({ exerciseId: exercise.id, sets: log.sets, done: log.done, note: log.note }));
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
