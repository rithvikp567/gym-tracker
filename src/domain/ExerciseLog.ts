import { unitSuffix, type LoadUnit } from "./Load";
import { SetEntry, formatNumber, type SetEntryData } from "./SetEntry";

export interface ExerciseLogData {
  exerciseId: string;
  sets: SetEntryData[];
  /** Only for check exercises: true = done, false = skipped, null = not answered. */
  done: boolean | null;
  /** That day's note for this exercise. */
  note: string;
}

/** What you did for one exercise in one session. Immutable. */
export class ExerciseLog {
  private constructor(
    readonly exerciseId: string,
    readonly sets: readonly SetEntry[],
    readonly done: boolean | null,
    readonly note: string,
  ) {}

  static empty(exerciseId: string): ExerciseLog {
    return new ExerciseLog(exerciseId, [], null, "");
  }

  static from(data: ExerciseLogData): ExerciseLog {
    return new ExerciseLog(data.exerciseId, (data.sets ?? []).map(SetEntry.from), data.done ?? null, data.note ?? "");
  }

  /** Sets that have a weight or reps filled in. */
  filledSets(): SetEntry[] {
    return this.sets.filter((s) => !s.isEmpty());
  }

  /** Heaviest weight lifted (the progress-chart metric). */
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
   * weight. Plates get a suffix: "2.5 pl", "3/2.5 pl".
   */
  weightLabel(unit: LoadUnit = "lb"): string {
    const filled = this.filledSets();
    if (!filled.length) return "";
    const weights = filled.map((s) => s.weight);
    if (weights.every((w) => w === null)) return "BW";
    const labels = weights.map((w) => (w === null ? "BW" : formatNumber(w)));
    const label = labels.every((l) => l === labels[0]) ? labels[0]! : labels.join("/");
    return `${label}${unitSuffix(unit)}`;
  }

  /** "8/8/7" */
  repsLabel(): string {
    return this.filledSets()
      .map((s) => (s.reps === null ? "–" : formatNumber(s.reps)))
      .join("/");
  }

  /** "135 · 8/8/7" (or "135 – 8/8/7" with a different separator, "2.5 pl · 8/8" for plates) */
  summary(separator = " · ", unit: LoadUnit = "lb"): string {
    if (this.done !== null && !this.filledSets().length) return this.done ? "Done" : "Skipped";
    return [this.weightLabel(unit), this.repsLabel()].filter(Boolean).join(separator);
  }

  withSets(sets: readonly SetEntry[]): ExerciseLog {
    return new ExerciseLog(this.exerciseId, [...sets], this.done, this.note);
  }

  withDone(done: boolean | null): ExerciseLog {
    return new ExerciseLog(this.exerciseId, this.sets, done, this.note);
  }

  withNote(note: string): ExerciseLog {
    return new ExerciseLog(this.exerciseId, this.sets, this.done, note);
  }

  /** The same log, filed under another exercise (merging exercises). */
  withExerciseId(exerciseId: string): ExerciseLog {
    return new ExerciseLog(exerciseId, this.sets, this.done, this.note);
  }

  /**
   * Both logs as one (two merged exercises logged on the same day): this log's sets, then the
   * other's; this "done" unless unanswered; both notes, one per line.
   */
  mergedWith(other: ExerciseLog): ExerciseLog {
    const notes = [this.note.trim(), other.note.trim()].filter(Boolean).join("\n");
    return new ExerciseLog(this.exerciseId, [...this.sets, ...other.sets], this.done ?? other.done, notes);
  }

  toJSON(): ExerciseLogData {
    return { exerciseId: this.exerciseId, sets: this.sets.map((s) => s.toJSON()), done: this.done, note: this.note };
  }
}
