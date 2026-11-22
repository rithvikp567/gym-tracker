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
  /** Pounds (default) or plates per side: what new weights are logged in. Missing in records saved before v0.3.0. */
  unit?: LoadUnit;
  /**
   * The unit of weights in its logs saved without one (imported sheet rows, logs from before units
   * were stored), when that isn't `unit`: switching units with "keep those" leaves them in the old
   * unit. It lives on the exercise rather than on each log, so a session re-saved on a device that
   * hadn't heard of the switch yet can't change what they mean. Missing = `unit`.
   */
  bareUnit?: LoadUnit;
  /**
   * Name keys this exercise also answers to: its names before a rename, and exercises merged
   * into it. Re-importing the sheet then lands old names on this exercise instead of
   * recreating them. Missing in records saved before v0.3.0.
   */
  aliases?: string[];
  /**
   * The name keys it took over by merging, in merge order. Where the sheet has rows under several
   * of its names on one date, its own names' sets come first and then these, in this order, as
   * merging combined them. Missing = no merge recorded (none, or merged before this was stored).
   */
  mergedKeys?: string[];
  /**
   * Name keys whose numbers are in another unit than `unit`: an exercise merged in keeps the unit
   * it was logged in, and switching units with "keep those" pins the old unit on the names logged
   * so far. Re-importing the sheet reads each name's rows in its unit. Missing = all in `unit`.
   */
  keyUnits?: Record<string, LoadUnit>;
}

/** What the numbers logged so far are when an exercise switches units: still the old unit, or the new one all along. */
export type PastUnits = "keep" | "relabel";

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
  /** The unit of weights in its logs saved without one (see ExerciseData.bareUnit); pass it to `ExerciseLog.unitOr`. */
  get bareUnit(): LoadUnit { return this.data.bareUnit ?? this.unit; }
  get aliases(): readonly string[] { return this.data.aliases ?? []; }
  get key(): string { return Exercise.keyOf(this.data.name); }

  /** True for its own name key or any alias (an old name, or an exercise merged into it). */
  answersTo(key: string): boolean {
    return this.key === key || this.aliases.includes(key);
  }

  /** The unit of numbers filed under one of its name keys (a sheet row, say): `unit` unless pinned. */
  unitOf(key: string): LoadUnit {
    return this.data.keyUnits?.[key] ?? this.unit;
  }

  /**
   * Where sets filed under one of its name keys go on a date that has several of its names (a
   * re-imported sheet): lower first. Its own names come before names it took over by merging, and
   * those follow in merge order, so a re-import combines a day as the merge did, renamed or not.
   */
  rowOrder(key: string): number {
    return Math.max(this.namesInOrder().indexOf(key), 0);
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

  /**
   * Logged in `unit` from now on. `past` says what the numbers under its names so far are:
   * "keep" = still the old unit (pinned on its names, so a re-import reads the sheet as before,
   * and on its logs saved without a unit through `bareUnit`), "relabel" = the new unit all along.
   * Logs saved with the old unit change separately (SetupService.setUnit).
   */
  withUnit(unit: LoadUnit, past: PastUnits): Exercise {
    const old = this.unit;
    if (unit === old) return this;
    const keyUnits: Record<string, LoadUnit> = {};
    for (const key of [this.key, ...this.aliases]) {
      const was = this.unitOf(key);
      keyUnits[key] = past === "relabel" && was === old ? unit : was;
    }
    const { bareUnit: _bare, ...rest } = this.data;
    const bareUnit = past === "keep" ? this.bareUnit : unit;
    return new Exercise(bareUnit === unit ? { ...rest, unit } : { ...rest, unit, bareUnit }).withKeyUnits(keyUnits);
  }

  /**
   * Takes over another exercise's names (merging it into this one): re-imported rows under them
   * land here, after this exercise's own (rowOrder), and are read in the unit `other` logged them in.
   */
  withNamesOf(other: Exercise): Exercise {
    const keys = other.namesInOrder();
    const taken = keys.filter((key) => !this.answersTo(key));
    const next = this.withAliases(keys);
    const keyUnits = { ...next.data.keyUnits };
    for (const key of keys) {
      if (key !== next.key) keyUnits[key] = other.unitOf(key);
    }
    return new Exercise({ ...next.data, mergedKeys: [...(this.data.mergedKeys ?? []), ...taken] }).withKeyUnits(keyUnits);
  }

  toJSON(): ExerciseData {
    return { ...this.data };
  }

  /** Its name keys in rowOrder: its own (name, then old names), then those taken over by merging. */
  private namesInOrder(): string[] {
    const merged = this.data.mergedKeys ?? [];
    return [...[this.key, ...this.aliases].filter((key) => !merged.includes(key)), ...merged];
  }

  /** Stores only the names whose unit differs from `unit` (the rest follow it). */
  private withKeyUnits(keyUnits: Record<string, LoadUnit>): Exercise {
    const pinned = Object.entries(keyUnits).filter(([, unit]) => unit !== this.unit);
    const { keyUnits: _old, ...rest } = this.data;
    return new Exercise(pinned.length ? { ...rest, keyUnits: Object.fromEntries(pinned) } : rest);
  }
}
