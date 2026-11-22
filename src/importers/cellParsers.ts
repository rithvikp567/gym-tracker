import type { SetEntryData } from "../domain/SetEntry";
import type { CellValue } from "./Grid";

export interface ParsedList {
  values: number[];
  /** "Body Weight" / "BW" */
  bodyweight: boolean;
  /** The original text when part of it wasn't a number ("7ish?", "No straps"), to keep as a note. */
  extra: string | null;
}

const EMPTY: ParsedList = { values: [], bodyweight: false, extra: null };

/**
 * Parses a weight or reps cell: "72.5/65", "8/8/7", "25 lbs", "35(down)", 160, or a date.
 *
 * Google Sheets turns "9/9" into the date Sep 9 (this year) and "8/7/7" into Aug 7 2007, so
 * dates are decoded back: a recent year means two numbers (month/day), an old one means three.
 */
export function parseNumberList(value: CellValue): ParsedList {
  if (value === null || value === "") return EMPTY;
  if (typeof value === "number") return { values: [value], bodyweight: false, extra: null };
  if (value instanceof Date) return { values: decodeDate(value), bodyweight: false, extra: null };
  if (typeof value !== "string") return EMPTY;

  const text = value.trim();
  if (!text) return EMPTY;
  if (/^(body\s*weight|bw)$/i.test(text)) return { values: [], bodyweight: true, extra: null };

  const values: number[] = [];
  let noisy = false;
  for (const part of text.split("/")) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(p);
    if (!m) {
      noisy = true;
      continue;
    }
    values.push(Number(m[1]));
    const rest = m[2]!.trim();
    if (rest && !/^(lbs?|kg)\.?$/i.test(rest)) noisy = true;
  }
  return { values, bodyweight: false, extra: noisy ? text : null };
}

export function decodeDate(d: Date): number[] {
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return year >= 2015 ? [month, day] : [month, day, year % 100];
}

/** One set per rep count; a single weight applies to every set. */
export function alignSets(weights: ParsedList, reps: ParsedList): SetEntryData[] {
  const w = weights.values;
  const r = reps.values;
  const n = Math.max(w.length, r.length);
  return Array.from({ length: n }, (_, i) => ({
    weight: w.length ? (w[i] ?? w[w.length - 1]!) : null,
    reps: r[i] ?? null,
  }));
}

/** "Done" → true, "Skipped"/"na"/"no" → false, anything else → null. */
export function parseDone(value: CellValue): boolean | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (/^(done|yes|y|x|✓|✔)/.test(t)) return true;
  if (/^(skip|na$|n\/a|no$|missed)/.test(t)) return false;
  return null;
}

/** A cell that only makes sense for a done/not-done exercise ("na" is ambiguous, so it doesn't count). */
export function isCheckWord(value: CellValue): boolean {
  return typeof value === "string" && /^(done|skipped?)$/i.test(value.trim());
}
