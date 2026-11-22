import type { ExerciseKind } from "../domain/Exercise";
import type { SetEntryData } from "../domain/SetEntry";

/**
 * What an importer produces: plain data, independent of the file format and of storage.
 * Exercises are referenced by `Exercise.keyOf(name)` until ImportService maps them to ids.
 */
export interface ImportPlan {
  source: string;
  days: ImportedDay[];
  /** Weekday (0 = Mon) → workout day name, used only if no split is set up yet. */
  split: (string | null)[];
  warnings: string[];
  /** Sessions dropped because they were exact copies of the week before. */
  skippedCopies: number;
}

export interface ImportedDay {
  name: string;
  exercises: ImportedExercise[];
  sessions: ImportedSession[];
}

export interface ImportedExercise {
  key: string;
  name: string;
  kind: ExerciseKind;
  targetSets: number | null;
  targetText: string | null;
  /** Still on the day in the latest week of the sheet; otherwise imported as archived. */
  active: boolean;
}

export interface ImportedSession {
  /** ISO date */
  date: string;
  /** e.g. "Mar · week 2" */
  label: string;
  logs: ImportedLog[];
}

export interface ImportedLog {
  key: string;
  sets: SetEntryData[];
  done: boolean | null;
  note: string;
}
