/** Day of the week, Monday first (ISO order): 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"] as const;
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DAY_MS = 86_400_000;

/**
 * A calendar date with no time or time zone (a workout happens "on Nov 20", wherever you are).
 * Immutable value object; serializes to ISO `YYYY-MM-DD`.
 */
export class LocalDate {
  private constructor(
    readonly year: number,
    /** 1–12 */
    readonly month: number,
    readonly day: number,
  ) {}

  /** Builds a date, normalizing overflow (e.g. Feb 30 → Mar 2). */
  static of(year: number, month: number, day: number): LocalDate {
    const d = new Date(Date.UTC(year, month - 1, day));
    return new LocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  static parse(iso: string): LocalDate {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error(`Not an ISO date: ${iso}`);
    return LocalDate.of(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  /** The date in the device's local time zone. */
  static fromDate(d: Date): LocalDate {
    return new LocalDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  static today(now: Date = new Date()): LocalDate {
    return LocalDate.fromDate(now);
  }

  static daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  toString(): string {
    return `${this.year}-${pad(this.month)}-${pad(this.day)}`;
  }

  toJSON(): string {
    return this.toString();
  }

  /** Midnight UTC of this date, handy as a numeric x-axis value. */
  toUtcMs(): number {
    return Date.UTC(this.year, this.month - 1, this.day);
  }

  addDays(n: number): LocalDate {
    return LocalDate.of(this.year, this.month, this.day + n);
  }

  addMonths(n: number): LocalDate {
    const target = LocalDate.of(this.year, this.month + n, 1);
    const day = Math.min(this.day, LocalDate.daysInMonth(target.year, target.month));
    return LocalDate.of(target.year, target.month, day);
  }

  weekday(): Weekday {
    const sundayFirst = new Date(this.toUtcMs()).getUTCDay();
    return ((sundayFirst + 6) % 7) as Weekday;
  }

  /** The Monday of this date's week. */
  startOfWeek(): LocalDate {
    return this.addDays(-this.weekday());
  }

  /** ISO-8601 week number (weeks start Monday; week 1 contains Jan 4). */
  isoWeek(): number {
    const thursday = this.addDays(3 - this.weekday());
    const jan4 = LocalDate.of(thursday.year, 1, 4);
    return 1 + Math.round((thursday.toUtcMs() - jan4.startOfWeek().toUtcMs()) / (7 * DAY_MS));
  }

  daysUntil(other: LocalDate): number {
    return Math.round((other.toUtcMs() - this.toUtcMs()) / DAY_MS);
  }

  compare(other: LocalDate): number {
    return this.toUtcMs() - other.toUtcMs();
  }

  equals(other: LocalDate): boolean {
    return this.compare(other) === 0;
  }

  isBefore(other: LocalDate): boolean {
    return this.compare(other) < 0;
  }

  isAfter(other: LocalDate): boolean {
    return this.compare(other) > 0;
  }

  /** "Thu · Nov 20" */
  label(): string {
    return `${WEEKDAY_SHORT[this.weekday()]} · ${MONTH_SHORT[this.month - 1]} ${this.day}`;
  }

  /** "Nov 20" */
  shortLabel(): string {
    return `${MONTH_SHORT[this.month - 1]} ${this.day}`;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
