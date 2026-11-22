import type { LocalDate } from "../domain/LocalDate";
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
