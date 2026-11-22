import { newId } from "./ids";
import type { LoadUnit } from "./Load";

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
  /** Pounds (default) or plates per side. Missing in records saved before v0.3.0. */
  unit?: LoadUnit;
  /**
   * Name keys this exercise also answers to: its names before a rename, and exercises merged
   * into it. Re-importing the sheet then lands old names on this exercise instead of
   * recreating them. Missing in records saved before v0.3.0.
   */
  aliases?: string[];
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
  get unit(): LoadUnit { return this.data.unit ?? "lb"; }
  get aliases(): readonly string[] { return this.data.aliases ?? []; }
  get key(): string { return Exercise.keyOf(this.data.name); }

  /** True for its own name key or any alias (an old name, or an exercise merged into it). */
  answersTo(key: string): boolean {
    return this.key === key || this.aliases.includes(key);
  }

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

  /** A new name; the old name stays an alias so re-imports and merges still find it. */
  renamed(name: string): Exercise {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.name) return this;
    return this.with({ name: trimmed }).withAliases([this.key]);
  }

  /** Adds name keys this exercise answers to (duplicates and its own key are dropped). */
  withAliases(keys: readonly string[]): Exercise {
    const own = this.key;
    const merged = [...new Set([...this.aliases, ...keys])].filter((k) => k && k !== own);
    return new Exercise({ ...this.data, aliases: merged });
  }

  toJSON(): ExerciseData {
    return { ...this.data };
  }
}
