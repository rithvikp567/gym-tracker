import { useEffect, useRef } from "react";
import type { LocalDate } from "../../domain/LocalDate";
import type { CalendarService } from "../../services/CalendarService";
import { rememberHomeDay } from "../homePick";
import { navigate } from "../router";
import { useServices } from "../ServicesContext";
import { slideNext } from "../slide";

/**
 * Steps a workout or rest-day screen to the day before or after. It opens whatever was
 * logged or planned that day (staying on the current workout if it was done then), or the
 * pick list on a rest day. Replaces the history entry, so Back still returns to where you
 * came from (Home, Calendar).
 */
export function useDayStep(date: LocalDate, currentDayId: string | null): (delta: -1 | 1) => void {
  const { calendar } = useServices();
  const busy = useRef(false);
  // Cleared when the screen goes away (set again on StrictMode's second mount).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return (delta) => {
    if (busy.current) return; // one step at a time: the lookup is async
    busy.current = true;
    stepToDay(calendar, date, currentDayId, delta, () => alive.current)
      .catch((e: unknown) => console.error(e))
      .finally(() => (busy.current = false));
  };
}

/**
 * Looks up what the day before or after `date` opens and goes there, unless `stillHere()`
 * says the screen was left meanwhile (Back, Last session…): the lookup reads every session
 * and can be slow, and going there then would pull you off the screen you moved to.
 */
export async function stepToDay(
  calendar: Pick<CalendarService, "dayTarget" | "today">,
  date: LocalDate,
  currentDayId: string | null,
  delta: -1 | 1,
  stillHere: () => boolean,
): Promise<void> {
  const target = date.addDays(delta);
  const t = await calendar.dayTarget(target, currentDayId);
  if (!stillHere()) return;
  slideNext(delta < 0 ? "back" : "forward");
  rememberHomeDay(target, calendar.today());
  navigate(
    t.kind === "workout" ? { name: "session", dayId: t.dayId, date: target.toString() } : { name: "day", date: target.toString() },
    { replace: true },
  );
}
