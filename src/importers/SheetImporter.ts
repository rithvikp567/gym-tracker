import type { Weekday } from "../domain/LocalDate";
import type { ImportPlan } from "../services/ImportPlan";
import type { Grid } from "./Grid";

export interface ImportOptions {
  /** Year of the first month block in the sheet. */
  startYear: number;
  /** Drop sessions that are exact copies of the week before (pre-filled, not done). */
  skipCopies: boolean;
  /** Workout day name → weekdays it's done on. Empty = flexible (placed on rest days). */
  weekdays: Record<string, Weekday[]>;
}

/**
 * One spreadsheet layout. Strategy pattern: supporting another layout (e.g. the older
 * push/pull tabs) means adding a class, not changing this one or the import screen.
 */
export interface SheetImporter {
  readonly label: string;
  canRead(grid: Grid): boolean;
  /** Workout day names in the order they first appear. */
  detectDays(grid: Grid): string[];
  suggestOptions(grid: Grid): ImportOptions;
  read(grid: Grid, options: ImportOptions, source: string): ImportPlan;
}
