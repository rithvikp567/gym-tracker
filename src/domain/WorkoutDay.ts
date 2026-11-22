import { Exercise, type ExerciseData, type ExerciseKind } from "./Exercise";
import { EPOCH, newId, type Syncable } from "./ids";

export interface WorkoutDayData extends Syncable {
  name: string;
  order: number;
  exercises: ExerciseData[];
}

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

  /** Replaces the exercise with the same id, or appends it. */
  withExercise(exercise: Exercise): WorkoutDay {
    const i = this.list.findIndex((e) => e.id === exercise.id);
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

  /** Takes an exercise off the day entirely (its logs must be moved or deleted separately). */
  removeExercise(id: string): WorkoutDay {
    return new WorkoutDay(this.data, this.list.filter((e) => e.id !== id));
  }

  /**
   * Folds one exercise into another: `from` disappears and `into` answers to its names, so a
   * re-import puts `from`'s rows on `into`. Move the session logs with `Session.mergeLogs`.
   */
  mergeExercise(fromId: string, intoId: string): WorkoutDay {
    const from = this.exercise(fromId);
    const into = this.exercise(intoId);
    if (!from || !into || fromId === intoId) return this;
    return this.withExercise(into.withAliases([from.key, ...from.aliases])).removeExercise(fromId);
  }

  /** Moves an active exercise up (-1) or down (+1) among the active ones. */
  moveExercise(id: string, delta: -1 | 1): WorkoutDay {
    const active = this.activeExercises();
    const from = active.findIndex((e) => e.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= active.length) return this;
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
}
