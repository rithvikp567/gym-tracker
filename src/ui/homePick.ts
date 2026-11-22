import { MONTH_SHORT, type LocalDate } from "../domain/LocalDate";
import type { CalendarDay, CalendarService } from "../services/CalendarService";
import { setViewState } from "./hooks/useViewState";

/**
 * The day picked on Home (and so the week it shows), remembered while the app is open. It
 * only counts on the day it was picked: open the app tomorrow and Home is back on today.
 */
export interface HomePick {
  date: string;
  /** The "today" it was picked on. */
  on: string;
}

export const HOME_PICK_KEY = "home.pick";

export function homePick(date: LocalDate, today: LocalDate): HomePick | null {
  return date.equals(today) ? null : { date: date.toString(), on: today.toString() };
}

/** Moves Home's pick from another screen, e.g. the day arrows on a workout screen. */
export function rememberHomeDay(date: LocalDate, today: LocalDate): void {
  setViewState(HOME_PICK_KEY, homePick(date, today));
}

/**
 * Home's data for one week (plan labels, dots, checks) as `useLive` / `prefetchLive` arguments:
 * one cache entry per week, keyed by today too (it decides the red dots). Home loads the weeks
 * either side ahead with the same key, so a step there draws at once.
 */
export function homeWeek(calendar: Pick<CalendarService, "week">, weekStart: LocalDate, today: LocalDate) {
  return {
    cacheAs: "week",
    deps: [weekStart.toString(), today.toString()],
    load: (): Promise<CalendarDay[]> => calendar.week(weekStart),
  };
}

/**
 * Home's date range for the week starting `weekStart`: "Nov 16 – 22", "Nov 30 – Dec 6". The
 * year shows once, after the end date, when it isn't this year ("Dec 1 – 7, 2025"), and on
 * both ends when the week spans New Year ("Dec 28, 2026 – Jan 3, 2027").
 */
export function weekRangeLabel(weekStart: LocalDate, today: LocalDate): string {
  const end = weekStart.addDays(6);
  const monthDay = (d: LocalDate) => `${MONTH_SHORT[d.month - 1]} ${d.day}`;
  if (end.year !== weekStart.year) return `${monthDay(weekStart)}, ${weekStart.year} – ${monthDay(end)}, ${end.year}`;
  const endText = end.month !== weekStart.month ? monthDay(end) : String(end.day);
  return `${monthDay(weekStart)} – ${endText}${end.year !== today.year ? `, ${end.year}` : ""}`;
}
