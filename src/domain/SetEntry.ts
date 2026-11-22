export interface SetEntryData {
  /** Weight in the user's unit; null = bodyweight / not recorded. */
  weight: number | null;
  reps: number | null;
}

/** One set of an exercise: weight × reps. Immutable value object. */
export class SetEntry {
  constructor(
    readonly weight: number | null,
    readonly reps: number | null,
  ) {}

  static from(data: SetEntryData): SetEntry {
    return new SetEntry(data.weight ?? null, data.reps ?? null);
  }

  isEmpty(): boolean {
    return this.weight === null && this.reps === null;
  }

  withWeight(weight: number | null): SetEntry {
    return new SetEntry(weight, this.reps);
  }

  withReps(reps: number | null): SetEntry {
    return new SetEntry(this.weight, reps);
  }

  toJSON(): SetEntryData {
    return { weight: this.weight, reps: this.reps };
  }
}

/** Formats 72.5 → "72.5", 135 → "135". */
export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
