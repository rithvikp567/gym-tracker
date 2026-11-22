import { platesToPounds, unitSuffix, type LoadUnit } from "./Load";
import { SetEntry, formatNumber, type SetEntryData } from "./SetEntry";

export interface ExerciseLogData {
  exerciseId: string;
  sets: SetEntryData[];
  /** Only for check exercises: true = done, false = skipped, null = not answered. */
  done: boolean | null;
  /** That day's note for this exercise. */
  note: string;
  /**
   * The unit the weights were saved in, so switching the exercise's unit later doesn't change
   * what they mean. Missing on logs saved before units were stored and on imported sheet rows in
   * the exercise's usual unit: those are in `Exercise.bareUnit`. Never set on a log without
   * weights (a note, bodyweight reps): only weights have a unit.
   */
  unit?: LoadUnit;
}

/** What you did for one exercise in one session. Immutable. */
export class ExerciseLog {
  /** The unit its weights were saved in; undefined = its exercise's (see ExerciseLogData). */
  readonly unit: LoadUnit | undefined;

  private constructor(
    readonly exerciseId: string,
    readonly sets: readonly SetEntry[],
    readonly done: boolean | null,
    readonly note: string,
    unit: LoadUnit | undefined,
  ) {
    // Only weights have a unit. A log without any follows its exercise, so weights typed into it
    // later are in the exercise's current unit and no unit switch has to remember it.
    this.unit = sets.some((s) => s.weight !== null) ? unit : undefined;
  }

  static empty(exerciseId: string): ExerciseLog {
    return new ExerciseLog(exerciseId, [], null, "", undefined);
  }

  static from(data: ExerciseLogData): ExerciseLog {
    return new ExerciseLog(data.exerciseId, (data.sets ?? []).map(SetEntry.from), data.done ?? null, data.note ?? "", data.unit);
  }

  /** The unit its weights are in: its own, or for a log saved without one, `bareUnit` (its exercise's `Exercise.bareUnit`). */
  unitOr(bareUnit: LoadUnit): LoadUnit {
    return this.unit ?? bareUnit;
  }

  /** Sets that have a weight or reps filled in. */
  filledSets(): SetEntry[] {
    return this.sets.filter((s) => !s.isEmpty());
  }

  /** Heaviest weight lifted (the progress-chart metric), in the log's unit. */
  topWeight(): number | null {
    const weights = this.filledSets()
      .map((s) => s.weight)
      .filter((w): w is number => w !== null);
    return weights.length ? Math.max(...weights) : null;
  }

  /** Counts as having trained: numbers logged or the check marked done. */
  hasResult(): boolean {
    return this.done === true || this.filledSets().length > 0;
  }

  /** Anything worth keeping, including a note alone. */
  hasContent(): boolean {
    return this.hasResult() || this.done === false || this.note.trim() !== "";
  }

  /**
   * "135" when every set used the same weight, "72.5/65" otherwise, "BW" for reps without
   * weight. Plates get a suffix: "2.5 pl", "3/2.5 pl". Always in the unit the log was saved in;
   * `exerciseUnit` only covers logs saved without one.
   */
  weightLabel(exerciseUnit: LoadUnit = "lb"): string {
    const filled = this.filledSets();
    if (!filled.length) return "";
    const weights = filled.map((s) => s.weight);
    if (weights.every((w) => w === null)) return "BW";
    const labels = weights.map((w) => (w === null ? "BW" : formatNumber(w)));
    const label = labels.every((l) => l === labels[0]) ? labels[0]! : labels.join("/");
    return `${label}${unitSuffix(this.unitOr(exerciseUnit))}`;
  }

  /** "8/8/7" */
  repsLabel(): string {
    return this.filledSets()
      .map((s) => (s.reps === null ? "–" : formatNumber(s.reps)))
      .join("/");
  }

  /** "135 · 8/8/7" (or "135 – 8/8/7" with a different separator, "2.5 pl · 8/8" for plates) */
  summary(separator = " · ", exerciseUnit: LoadUnit = "lb"): string {
    if (this.done !== null && !this.filledSets().length) return this.done ? "Done" : "Skipped";
    return [this.weightLabel(exerciseUnit), this.repsLabel()].filter(Boolean).join(separator);
  }

  withSets(sets: readonly SetEntry[]): ExerciseLog {
    return new ExerciseLog(this.exerciseId, [...sets], this.done, this.note, this.unit);
  }

  withDone(done: boolean | null): ExerciseLog {
    return new ExerciseLog(this.exerciseId, this.sets, done, this.note, this.unit);
  }

  withNote(note: string): ExerciseLog {
    return new ExerciseLog(this.exerciseId, this.sets, this.done, note, this.unit);
  }

  /** The same numbers, saved as being in `unit` (undefined = follow the exercise). Nothing is converted. */
  withUnit(unit: LoadUnit | undefined): ExerciseLog {
    return new ExerciseLog(this.exerciseId, this.sets, this.done, this.note, unit);
  }

  /** The same log, filed under another exercise (merging exercises). */
  withExerciseId(exerciseId: string): ExerciseLog {
    return new ExerciseLog(exerciseId, this.sets, this.done, this.note, this.unit);
  }

  /**
   * Both logs as one (two merged exercises logged on the same day): this log's sets, then the
   * other's; Done if either was done, otherwise this log's answer unless unanswered; both notes,
   * one per line. Weights in two units combine in pounds (plates convert exactly); a log without
   * weights (a note, bodyweight reps) has nothing to convert, so the other's stay in their unit.
   * `exerciseUnit` is the unit of a log saved without one.
   */
  mergedWith(other: ExerciseLog, exerciseUnit: LoadUnit = "lb"): ExerciseLog {
    const notes = [this.note.trim(), other.note.trim()].filter(Boolean).join("\n");
    const done = this.done === true || other.done === true ? true : (this.done ?? other.done);
    const mine = this.unitOr(exerciseUnit);
    const theirs = other.unitOr(exerciseUnit);
    const combined = (sets: SetEntry[], unit: LoadUnit | undefined) => new ExerciseLog(this.exerciseId, sets, done, notes, unit);
    if (mine === theirs) return combined([...this.sets, ...other.sets], this.unit ?? other.unit);
    if (other.topWeight() === null) return combined([...this.sets, ...other.sets], this.unit);
    if (this.topWeight() === null) return combined([...this.sets, ...other.sets], other.unit);
    return combined([...this.poundSets(mine), ...other.poundSets(theirs)], "lb");
  }

  toJSON(): ExerciseLogData {
    const data: ExerciseLogData = { exerciseId: this.exerciseId, sets: this.sets.map((s) => s.toJSON()), done: this.done, note: this.note };
    if (this.unit) data.unit = this.unit;
    return data;
  }

  /** The sets with their weights in pounds, given the unit they're in. */
  private poundSets(unit: LoadUnit): SetEntry[] {
    return this.sets.map((s) => (unit === "plates" && s.weight !== null ? s.withWeight(platesToPounds(s.weight)) : s));
  }
}
