import { Exercise, type ExerciseData, type ExerciseKind } from "./Exercise";
import { EPOCH, newId, type Syncable } from "./ids";
import type { LoadUnit } from "./Load";

/** An exercise merged into another or deleted. Only its id is kept, as a tombstone. */
export interface RetiredExercise {
  id: string;
  /** The exercise it was merged into; missing when it was deleted. */
  mergedInto?: string;
  /** The unit of its logs saved without one when it was merged (its `Exercise.bareUnit`). */
  unit?: LoadUnit;
}

export interface WorkoutDayData extends Syncable {
  name: string;
  order: number;
  exercises: ExerciseData[];
  /**
   * Exercises merged or deleted on this day, kept apart from `exercises` so logs for them that
   * sync in later (saved on another device before it heard) can still be filed or dropped
   * (SetupService.reconcile). Missing in older records.
   */
  retired?: RetiredExercise[];
}

/** Where logs for a merged or deleted exercise belong now. */
export type RetiredFate = { kind: "merge"; into: Exercise; unit: LoadUnit } | { kind: "drop" };

/** A workout template such as "Upper 1": an ordered list of exercises. Immutable. */
export class WorkoutDay {
  private constructor(
    private readonly data: Omit<WorkoutDayData, "exercises">,
    private readonly list: readonly Exercise[],
  ) {}

  static create(name: string, order: number): WorkoutDay {
    return new WorkoutDay({ id: newId(), name: name.trim(), order, updatedAt: EPOCH, deleted: false }, []);
  }

  static from(data: WorkoutDayData): WorkoutDay {
    const { exercises, ...rest } = data;
    return new WorkoutDay({ ...rest }, exercises.map(Exercise.from));
  }

  get id(): string { return this.data.id; }
  get name(): string { return this.data.name; }
  get order(): number { return this.data.order; }
  get updatedAt(): string { return this.data.updatedAt; }
  get deleted(): boolean { return this.data.deleted; }

  /** Every exercise ever on this day, including archived ones (for history). */
  allExercises(): readonly Exercise[] {
    return this.list;
  }

  /** The exercises you do today, in order. */
  activeExercises(): Exercise[] {
    return this.list.filter((e) => !e.archived);
  }

  exercise(id: string): Exercise | undefined {
    return this.list.find((e) => e.id === id);
  }

  /** By name key: an exact name match first, then old names and merged exercises (aliases). */
  exerciseByKey(key: string): Exercise | undefined {
    return this.list.find((e) => e.key === key) ?? this.list.find((e) => e.answersTo(key));
  }

  /** Tombstones of exercises merged away or deleted, oldest first. */
  retiredExercises(): readonly RetiredExercise[] {
    return this.data.retired ?? [];
  }

  /** True for an exercise merged away or deleted from this day. */
  isRetired(id: string): boolean {
    return this.retiredExercises().some((r) => r.id === id);
  }

  /**
   * For a log on an exercise that was merged or deleted (and isn't on the day): the exercise it
   * belongs to now, following merges of merges (A → B → C), with the unit of a log saved without
   * one; or "drop" when the chain ends in a delete. Undefined when there's nothing to do or no safe
   * answer: the id is on the day, unknown, caught in a loop, or merged into something gone.
   */
  retiredFate(id: string): RetiredFate | undefined {
    const retired = this.retiredExercises();
    const own = this.exercise(id) ? undefined : retired.find((r) => r.id === id);
    if (!own) return undefined;
    const seen = new Set<string>();
    let step: RetiredExercise | undefined = own;
    while (step && !seen.has(step.id)) {
      const intoId: string | undefined = step.mergedInto;
      if (!intoId) return { kind: "drop" };
      seen.add(step.id);
      const into = this.exercise(intoId);
      if (into) return { kind: "merge", into, unit: own.unit ?? "lb" };
      step = retired.find((r) => r.id === intoId);
    }
    return undefined;
  }

  rename(name: string): WorkoutDay {
    return this.copy({ name: name.trim() });
  }

  withOrder(order: number): WorkoutDay {
    return this.copy({ order });
  }

  markDeleted(): WorkoutDay {
    return this.copy({ deleted: true });
  }

  withUpdatedAt(updatedAt: string): WorkoutDay {
    return this.copy({ updatedAt });
  }

  addExercise(name: string, kind: ExerciseKind = "strength"): WorkoutDay {
    return this.withExercise(Exercise.create(name, kind));
  }

  /**
   * Replaces the exercise with the same id, or appends it. An exercise that was merged or deleted
   * stays gone, so an edit made from a stale copy can't bring it back.
   */
  withExercise(exercise: Exercise): WorkoutDay {
    const i = this.list.findIndex((e) => e.id === exercise.id);
    if (i < 0 && this.isRetired(exercise.id)) return this;
    const list = [...this.list];
    if (i >= 0) list[i] = exercise;
    else list.push(exercise);
    return new WorkoutDay(this.data, list);
  }

  archiveExercise(id: string): WorkoutDay {
    const ex = this.exercise(id);
    return ex ? this.withExercise(ex.with({ archived: true })) : this;
  }

  /** Brings a removed exercise back; it joins the end of the active list. */
  restoreExercise(id: string): WorkoutDay {
    const ex = this.exercise(id);
    if (!ex || !ex.archived) return this;
    const active = this.activeExercises();
    const archived = this.list.filter((e) => e.archived && e.id !== id);
    return new WorkoutDay(this.data, [...active, ex.with({ archived: false }), ...archived]);
  }

  /**
   * Takes an exercise off the day for good (deleting it with its history; delete its logs
   * separately). It's remembered as deleted, so logs for it that sync in later are dropped too.
   */
  removeExercise(id: string): WorkoutDay {
    return this.exercise(id) ? this.retire({ id }) : this;
  }

  /**
   * Folds one exercise into another: `from` disappears and `into` answers to its names (read in
   * `from`'s units), so a re-import puts `from`'s rows on `into`. `from` is remembered as merged,
   * so its logs that sync in later follow. Move the session logs with `Session.mergeLogs`.
   */
  mergeExercise(fromId: string, intoId: string): WorkoutDay {
    const from = this.exercise(fromId);
    const into = this.exercise(intoId);
    if (!from || !into || fromId === intoId) return this;
    return this.withExercise(into.withNamesOf(from)).retire({ id: fromId, mergedInto: intoId, unit: from.bareUnit });
  }

  /**
   * Moves an active exercise to `index` among the active ones (dragged there), clamped to the
   * list. The same day comes back when nothing would move.
   */
  moveExerciseTo(id: string, index: number): WorkoutDay {
    const active = this.activeExercises();
    const from = active.findIndex((e) => e.id === id);
    if (from < 0 || !Number.isFinite(index)) return this;
    const to = Math.max(0, Math.min(active.length - 1, Math.trunc(index)));
    if (to === from) return this;
    const reordered = [...active];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);
    const archived = this.list.filter((e) => e.archived);
    return new WorkoutDay(this.data, [...reordered, ...archived]);
  }

  toJSON(): WorkoutDayData {
    return { ...this.data, exercises: this.list.map((e) => e.toJSON()) };
  }

  private copy(changes: Partial<Omit<WorkoutDayData, "exercises" | "id">>): WorkoutDay {
    return new WorkoutDay({ ...this.data, ...changes }, this.list);
  }

  /** Drops an exercise from the list and keeps its tombstone. */
  private retire(tombstone: RetiredExercise): WorkoutDay {
    return new WorkoutDay(
      { ...this.data, retired: [...this.retiredExercises(), tombstone] },
      this.list.filter((e) => e.id !== tombstone.id),
    );
  }
}
