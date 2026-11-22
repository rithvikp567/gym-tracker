import { newId } from "./ids";

/** strength = weight × reps per set; check = done / not done (e.g. cardio). */
export type ExerciseKind = "strength" | "check";

export interface ExerciseData {
  id: string;
  name: string;
  kind: ExerciseKind;
  targetSets: number | null;
  /** Free text so ranges work: "8", "8-10". */
  targetReps: string | null;
  /** Shown for check exercises, e.g. "45 min walk". */
  targetText: string | null;
  /** Removed from the day but kept so its history and chart line survive. */
  archived: boolean;
}

/** An exercise slot within a workout day (its 3 columns in the old sheet). */
export class Exercise {
  private constructor(private readonly data: ExerciseData) {}

  static create(name: string, kind: ExerciseKind = "strength"): Exercise {
    return new Exercise({
      id: newId(),
      name: name.trim(),
      kind,
      targetSets: null,
      targetReps: null,
      targetText: null,
      archived: false,
    });
  }

  static from(data: ExerciseData): Exercise {
    return new Exercise({ ...data });
  }

  /**
   * Identity used to match names across sheet weeks: case, spacing, punctuation,
   * and a trailing set count like "(3)" are ignored. "Tricep Pushdown" = "tricep push down".
   */
  static keyOf(name: string): string {
    return name
      .toLowerCase()
      .replace(/\(\s*\d+\s*\)\s*$/, "")
      .replace(/[^a-z0-9]/g, "");
  }

  get id(): string { return this.data.id; }
  get name(): string { return this.data.name; }
  get kind(): ExerciseKind { return this.data.kind; }
  get targetSets(): number | null { return this.data.targetSets; }
  get targetReps(): string | null { return this.data.targetReps; }
  get targetText(): string | null { return this.data.targetText; }
  get archived(): boolean { return this.data.archived; }
  get key(): string { return Exercise.keyOf(this.data.name); }

  /** "3×8", "3 sets", "8 reps", "45 min walk", or "". */
  targetLabel(): string {
    if (this.kind === "check") return this.targetText ?? "";
    const { targetSets: s, targetReps: r } = this.data;
    if (s && r) return `${s}×${r}`;
    if (s) return `${s} set${s === 1 ? "" : "s"}`;
    if (r) return `${r} reps`;
    return "";
  }

  with(changes: Partial<Omit<ExerciseData, "id">>): Exercise {
    const next = { ...this.data, ...changes };
    next.name = next.name.trim();
    return new Exercise(next);
  }

  toJSON(): ExerciseData {
    return { ...this.data };
  }
}
