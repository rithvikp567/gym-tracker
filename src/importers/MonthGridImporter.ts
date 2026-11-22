import { Exercise, type ExerciseKind } from "../domain/Exercise";
import { LocalDate, MONTH_SHORT, type Weekday } from "../domain/LocalDate";
import type { ImportedDay, ImportedExercise, ImportedLog, ImportedSession, ImportPlan } from "../services/ImportPlan";
import { alignSets, isCheckWord, parseDone, parseNumberList } from "./cellParsers";
import type { Grid } from "./Grid";
import type { ImportOptions, SheetImporter } from "./SheetImporter";

/*
 * The layout of the "Upper Lower" tab:
 *
 *   Feb                               March   WEEK 1             WEEK 2 …
 *       Upper 1                               Upper 1
 *       pulldown        160  10/10            pulldown   160  7/7
 *       incline press   70   7/7              …
 *
 *       Lower                                 Upper 2
 *       …
 *
 * Month blocks are tiled 3 across and 4 down. Each month has 4 weeks; each week is a column
 * group of [exercise, weight, reps-per-set]. Inside a week, workout days are stacked: a
 * title row ("Upper 1") after a blank row, then one row per exercise.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Training slots handed out in order when guessing the split: Mon, Tue, Thu, Fri, Sat, Wed, Sun. */
const SLOTS: readonly Weekday[] = [0, 1, 3, 4, 5, 2, 6];

interface MonthBlock {
  order: number;
  month: number;
  headerRow: number;
  endRow: number;
  weeks: { n: number; col: number }[];
}

interface DayBlock {
  title: string;
  rows: number[];
}

interface WeekColumn {
  block: MonthBlock;
  week: number;
  col: number;
  days: DayBlock[];
}

interface ExerciseAcc {
  key: string;
  name: string;
  kind: ExerciseKind;
  targetSets: number | null;
  targetText: string | null;
  firstSeen: number;
}

interface DayAcc {
  exercises: Map<string, ExerciseAcc>;
  latestKeys: string[];
  sessions: (ImportedSession & { group: number })[];
}

export class MonthGridImporter implements SheetImporter {
  readonly label = "Month blocks with 4 weeks each";

  canRead(grid: Grid): boolean {
    return this.detectDays(grid).length > 0;
  }

  detectDays(grid: Grid): string[] {
    const names: string[] = [];
    for (const week of this.weekColumns(grid)) {
      for (const day of week.days) if (!names.includes(day.title)) names.push(day.title);
    }
    return names;
  }

  suggestOptions(grid: Grid): ImportOptions {
    const weekdays: Record<string, Weekday[]> = {};
    let slot = 0;
    for (const name of this.detectDays(grid)) {
      weekdays[name] = /cardio|abs/i.test(name) ? [] : [SLOTS[slot++ % SLOTS.length]!];
    }
    return { startYear: suggestYear(grid), skipCopies: true, weekdays };
  }

  read(grid: Grid, options: ImportOptions, source: string): ImportPlan {
    const warnings: string[] = [];
    let weightOnlyRows = 0;
    const weeks = this.weekColumns(grid);
    const yearOf = blockYears(weeks.map((w) => w.block), options.startYear);
    const rest = restWeekdays(options.weekdays);
    const days = new Map<string, DayAcc>();
    let seen = 0;

    for (const week of weeks) {
      const weekStart = firstMonday(yearOf.get(week.block.order)!, week.block.month).addDays(7 * (week.week - 1));
      const label = `${MONTH_SHORT[week.block.month - 1]} · week ${week.week}`;

      for (const day of week.days) {
        const acc: DayAcc = days.get(day.title) ?? { exercises: new Map(), latestKeys: [], sessions: [] };
        days.set(day.title, acc);
        acc.latestKeys = []; // weeks run oldest → newest, so the last week seen wins
        const planned = options.weekdays[day.title] ?? [];

        for (const [group, rows] of groupRows(grid, week.col, day.rows, planned.length === 0).entries()) {
          const weekday = planned[0] ?? rest[group % Math.max(rest.length, 1)] ?? 5;
          const logs: ImportedLog[] = [];
          for (const row of rows) {
            const exercise = this.trackExercise(acc, grid, row, week.col, seen++);
            if (!acc.latestKeys.includes(exercise.key)) acc.latestKeys.push(exercise.key);
            const parsed = parseLog(grid, row, week.col, exercise);
            if (parsed.weightOnly) weightOnlyRows++;
            if (parsed.note && parsed.log) warnings.push(`${day.title} · ${label} · ${exercise.name}: kept "${parsed.note}" as a note`);
            if (parsed.log) logs.push(parsed.log);
          }
          if (logs.some((l) => l.done === true || l.sets.length > 0)) {
            acc.sessions.push({ date: weekStart.addDays(weekday).toString(), label, logs, group });
          }
        }
      }
    }

    let skippedCopies = 0;
    const importedDays: ImportedDay[] = [];
    for (const [name, acc] of days) {
      const sessions = options.skipCopies ? dropCopies(acc.sessions) : acc.sessions;
      skippedCopies += acc.sessions.length - sessions.length;
      importedDays.push({
        name,
        exercises: orderedExercises(acc),
        sessions: sessions.map(({ group: _group, ...s }) => s),
      });
    }

    if (weightOnlyRows) {
      warnings.unshift(`${weightOnlyRows} rows had a weight but no reps; treated as planned, not done.`);
    }

    const split: (string | null)[] = [null, null, null, null, null, null, null];
    for (const [name, weekdays] of Object.entries(options.weekdays)) {
      for (const wd of weekdays) split[wd] ??= name;
    }

    return { source, days: importedDays, split, warnings, skippedCopies };
  }

  private trackExercise(acc: DayAcc, grid: Grid, row: number, col: number, seen: number): ExerciseAcc {
    const raw = grid.text(row, col);
    const cardio = isCardioName(raw);
    const key = cardio ? "cardio" : Exercise.keyOf(raw);
    const ex: ExerciseAcc = acc.exercises.get(key) ?? {
      key,
      name: raw,
      kind: cardio ? "check" : "strength",
      targetSets: null,
      targetText: null,
      firstSeen: seen,
    };
    ex.name = cardio ? "Cardio" : raw.replace(/\(\s*\d+\s*\)\s*$/, "").trim();
    const sets = /\(\s*(\d+)\s*\)\s*$/.exec(raw);
    if (sets) ex.targetSets = Number(sets[1]);
    if (isCheckWord(grid.cell(row, col + 2))) ex.kind = "check";
    const weightText = grid.text(row, col + 1);
    if (ex.kind === "check" && weightText && !/^na$/i.test(weightText)) ex.targetText = weightText;
    acc.exercises.set(key, ex);
    return ex;
  }

  /** Every month block, in reading order (left → right, top → bottom). */
  private monthBlocks(grid: Grid): MonthBlock[] {
    const labels: { row: number; col: number; month: number }[] = [];
    const headers: { row: number; col: number; n: number }[] = [];
    for (const { row, col, value } of grid.cells()) {
      if (typeof value !== "string") continue;
      const t = value.trim().toLowerCase();
      const month = MONTHS[t];
      if (month) labels.push({ row, col, month });
      const week = /^week\s*(\d+)$/.exec(t);
      if (week) headers.push({ row, col, n: Number(week[1]) });
    }

    // Learn the layout from a fully labeled month: WEEK 1 is `offset` right of the month name,
    // and weeks are `spacing` columns apart. (Feb has no WEEK headers; December has no name.)
    let offset = 1;
    let spacing = 4;
    for (const label of labels) {
      const w1 = headers.find((h) => h.row === label.row && h.n === 1 && h.col > label.col && h.col <= label.col + 4);
      const w2 = w1 && headers.find((h) => h.row === w1.row && h.n === 2 && h.col > w1.col && h.col <= w1.col + 8);
      if (w1 && w2) {
        offset = w1.col - label.col;
        spacing = w2.col - w1.col;
        break;
      }
    }

    const used = new Set<(typeof headers)[number]>();
    const raw: { row: number; col: number; month: number | null; weeks: { n: number; col: number }[] }[] = [];
    for (const label of labels) {
      const nextLabel = Math.min(...labels.filter((l) => l.row === label.row && l.col > label.col).map((l) => l.col), Infinity);
      const own = headers.filter(
        (h) => h.row === label.row && h.col > label.col && h.col < nextLabel && h.col <= label.col + offset + spacing * 4,
      );
      own.forEach((h) => used.add(h));
      const weeks = own.length
        ? own.map((h) => ({ n: h.n, col: h.col }))
        : [1, 2, 3, 4].map((n) => ({ n, col: label.col + offset + spacing * (n - 1) }));
      raw.push({ row: label.row, col: label.col, month: label.month, weeks });
    }
    for (const w1 of headers.filter((h) => h.n === 1 && !used.has(h))) {
      if (used.has(w1)) continue;
      const group = headers.filter((h) => !used.has(h) && h.row === w1.row && h.col >= w1.col && h.col < w1.col + spacing * 4);
      group.forEach((h) => used.add(h));
      raw.push({ row: w1.row, col: w1.col - offset, month: null, weeks: group.map((h) => ({ n: h.n, col: h.col })) });
    }

    raw.sort((a, b) => a.row - b.row || a.col - b.col);
    const bandStarts = [...new Set(raw.map((b) => b.row))].sort((a, b) => a - b);
    let previous = 0;
    return raw.map((b, order) => {
      const month = b.month ?? (previous % 12) + 1;
      previous = month;
      const nextBand = bandStarts.find((r) => r > b.row) ?? grid.rowCount;
      return { order, month, headerRow: b.row, endRow: nextBand - 1, weeks: b.weeks.sort((x, y) => x.n - y.n) };
    });
  }

  private weekColumns(grid: Grid): WeekColumn[] {
    const out: WeekColumn[] = [];
    for (const block of this.monthBlocks(grid)) {
      for (const { n, col } of block.weeks) {
        out.push({ block, week: n, col, days: dayBlocks(grid, col, block.headerRow + 1, block.endRow) });
      }
    }
    return out;
  }
}

/** A title is the first name after a blank row, with empty weight/reps and an exercise under it. */
function dayBlocks(grid: Grid, col: number, from: number, to: number): DayBlock[] {
  const days: DayBlock[] = [];
  let current: DayBlock | null = null;
  let afterGap = true;
  for (let r = from; r <= to; r++) {
    const name = grid.text(r, col);
    if (!name) {
      current = null;
      afterGap = true;
      continue;
    }
    const isTitle =
      afterGap && grid.isEmpty(r, col + 1) && grid.isEmpty(r, col + 2) && grid.text(r + 1, col) !== "" && !isCardioName(name);
    afterGap = false;
    if (isTitle) {
      current = { title: name, rows: [] };
      days.push(current);
    } else if (current) {
      current.rows.push(r);
    }
  }
  return days;
}

/** Flexible days (Abs/Cardio) hold several sessions a week: each "Cardio N" row starts one. */
function groupRows(grid: Grid, col: number, rows: number[], flexible: boolean): number[][] {
  const groups: number[][] = [];
  for (const r of rows) {
    const startsGroup = flexible && isCardioName(grid.text(r, col)) && (groups.at(-1)?.length ?? 0) > 0;
    if (!groups.length || startsGroup) groups.push([r]);
    else groups.at(-1)!.push(r);
  }
  return groups;
}

function parseLog(
  grid: Grid,
  row: number,
  col: number,
  exercise: ExerciseAcc,
): { log: ImportedLog | null; note: string; weightOnly: boolean } {
  const weightCell = grid.cell(row, col + 1);
  const repsCell = grid.cell(row, col + 2);

  if (exercise.kind === "check") {
    const done = parseDone(repsCell);
    const text = typeof repsCell === "string" ? repsCell.trim() : "";
    const note = done === null ? text : "";
    if (done === null && !note) return { log: null, note: "", weightOnly: false };
    return { log: { key: exercise.key, sets: [], done, note }, note, weightOnly: false };
  }

  const weights = parseNumberList(weightCell);
  const reps = parseNumberList(repsCell);
  // Reps are what you write after doing a set; a weight alone is usually pre-filled.
  const sets = reps.values.length ? alignSets(weights, reps) : [];
  const note = [...new Set([weights.extra, reps.extra].filter((t): t is string => !!t))].join(" · ");
  const weightOnly = !reps.values.length && weights.values.length > 0;
  if (!sets.length && !note) return { log: null, note: "", weightOnly };
  return { log: { key: exercise.key, sets, done: null, note }, note, weightOnly };
}

/** Removes sessions identical to the same day's previous week (copied forward, not done). */
function dropCopies<T extends ImportedSession & { group: number }>(sessions: T[]): T[] {
  const last = new Map<number, string>();
  return sessions.filter((s) => {
    const signature = JSON.stringify([...s.logs].sort((a, b) => a.key.localeCompare(b.key)));
    const isCopy = last.get(s.group) === signature;
    last.set(s.group, signature);
    return !isCopy;
  });
}

function orderedExercises(acc: DayAcc): ImportedExercise[] {
  const all = [...acc.exercises.values()];
  const active = acc.latestKeys.map((k) => acc.exercises.get(k)!).filter(Boolean);
  const archived = all.filter((e) => !acc.latestKeys.includes(e.key)).sort((a, b) => a.firstSeen - b.firstSeen);
  return [
    ...active.map((e) => toImported(e, true)),
    ...archived.map((e) => toImported(e, false)),
  ];
}

function toImported(e: ExerciseAcc, active: boolean): ImportedExercise {
  return { key: e.key, name: e.name, kind: e.kind, targetSets: e.targetSets, targetText: e.targetText, active };
}

function isCardioName(name: string): boolean {
  return /^cardio\b/i.test(name.trim());
}

function firstMonday(year: number, month: number): LocalDate {
  const first = LocalDate.of(year, month, 1);
  return first.addDays((7 - first.weekday()) % 7);
}

function blockYears(blocks: MonthBlock[], startYear: number): Map<number, number> {
  const years = new Map<number, number>();
  let year = startYear;
  let previous: number | null = null;
  for (const b of blocks) {
    if (years.has(b.order)) continue;
    if (previous !== null && b.month < previous) year++;
    previous = b.month;
    years.set(b.order, year);
  }
  return years;
}

function restWeekdays(weekdays: Record<string, Weekday[]>): Weekday[] {
  const busy = new Set(Object.values(weekdays).flat());
  return ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).filter((d) => !busy.has(d));
}

/** Sheets stores "9/9" as a date in the year it was typed, which tells us the sheet's year. */
function suggestYear(grid: Grid): number {
  const counts = new Map<number, number>();
  for (const { value } of grid.cells()) {
    if (value instanceof Date && value.getUTCFullYear() >= 2015) {
      const y = value.getUTCFullYear();
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
  }
  let best = new Date().getFullYear();
  let max = 0;
  for (const [y, n] of counts) if (n > max) [best, max] = [y, n];
  return best;
}
