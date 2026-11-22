import { useRef } from "react";
import type { LocalDate } from "../../domain/LocalDate";
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
  return (delta) => {
    if (busy.current) return; // one step at a time: the lookup is async
    busy.current = true;
    const target = date.addDays(delta);
    calendar
      .dayTarget(target, currentDayId)
      .then((t) => {
        slideNext(delta < 0 ? "back" : "forward");
        rememberHomeDay(target, calendar.today());
        navigate(
          t.kind === "workout" ? { name: "session", dayId: t.dayId, date: target.toString() } : { name: "day", date: target.toString() },
          { replace: true },
        );
      })
      .catch((e: unknown) => console.error(e))
      .finally(() => (busy.current = false));
  };
}
