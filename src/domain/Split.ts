import { EPOCH, type Syncable } from "./ids";
import type { LocalDate, Weekday } from "./LocalDate";

export interface SplitData extends Syncable {
  name: string;
  /** 7 entries, Monday first: the workout day id planned that weekday, or null for rest. */
  pattern: (string | null)[];
}

/** The weekly plan, e.g. Upper 1 · Lower · rest · Upper 2 · Lower · rest · rest. */
export class Split {
  static readonly DEFAULT_ID = "default";

  private constructor(private readonly data: SplitData) {}

  static empty(): Split {
    return new Split({
      id: Split.DEFAULT_ID,
      name: "My split",
      pattern: [null, null, null, null, null, null, null],
      updatedAt: EPOCH,
      deleted: false,
    });
  }

  static from(data: SplitData): Split {
    const pattern = Array.from({ length: 7 }, (_, i) => data.pattern[i] ?? null);
    return new Split({ ...data, pattern });
  }

  get id(): string { return this.data.id; }
  get updatedAt(): string { return this.data.updatedAt; }
  get pattern(): readonly (string | null)[] { return this.data.pattern; }

  plannedOn(weekday: Weekday): string | null {
    return this.data.pattern[weekday] ?? null;
  }

  plannedFor(date: LocalDate): string | null {
    return this.plannedOn(date.weekday());
  }

  weekdaysFor(workoutDayId: string): Weekday[] {
    return this.weekdays((id) => id === workoutDayId);
  }

  restWeekdays(): Weekday[] {
    return this.weekdays((id) => id === null);
  }

  hasAnyPlan(): boolean {
    return this.data.pattern.some((id) => id !== null);
  }

  withWeekday(weekday: Weekday, workoutDayId: string | null): Split {
    const pattern = [...this.data.pattern];
    pattern[weekday] = workoutDayId;
    return new Split({ ...this.data, pattern });
  }

  /** Drops a deleted workout day from the plan. */
  without(workoutDayId: string): Split {
    return new Split({ ...this.data, pattern: this.data.pattern.map((id) => (id === workoutDayId ? null : id)) });
  }

  withUpdatedAt(updatedAt: string): Split {
    return new Split({ ...this.data, updatedAt });
  }

  toJSON(): SplitData {
    return { ...this.data, pattern: [...this.data.pattern] };
  }

  private weekdays(match: (id: string | null) => boolean): Weekday[] {
    const out: Weekday[] = [];
    this.data.pattern.forEach((id, i) => {
      if (match(id)) out.push(i as Weekday);
    });
    return out;
  }
}
