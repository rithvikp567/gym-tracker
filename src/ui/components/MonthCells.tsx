import { LocalDate, WEEKDAY_LETTER } from "../../domain/LocalDate";
import type { CalendarDay } from "../../services/CalendarService";

/** What a date's dot says: a workout (done), a planned day missed, or nothing to mark. */
export type DayMark = CalendarDay["status"] | undefined;

/**
 * A month's weekday letters and dates (Monday first), from the dates alone; the data only adds
 * the dots, so nothing moves when it lands. Used by the Calendar's year view (dates as text: the
 * whole month is the button), its popped-out month and the date picker (`onPick` makes each date
 * a button; `selected` fills the picked one with the accent). Goes inside a `.month-grid`.
 */
export function MonthCells({
  dates,
  today,
  statusOf,
  onPick,
  selected,
}: {
  dates: readonly LocalDate[];
  today: LocalDate;
  statusOf: (date: LocalDate) => DayMark;
  onPick?: (date: LocalDate) => void;
  selected?: LocalDate;
}) {
  return (
    <>
      {WEEKDAY_LETTER.map((l, i) => (
        <span className="wd" key={i}>
          {l}
        </span>
      ))}
      {Array.from({ length: dates[0]!.weekday() }, (_, i) => (
        <span key={`pad${i}`} />
      ))}
      {dates.map((date) => {
        const status = statusOf(date);
        const isSelected = selected?.equals(date) ?? false;
        const marks = `${date.equals(today) ? " today" : ""}${date.isAfter(today) ? " future" : ""}${isSelected ? " selected" : ""}`;
        const dot = <span className="dot-slot">{(status === "done" || status === "missed") && <span className={`dot ${status}`} />}</span>;
        return onPick ? (
          <button
            key={date.toString()}
            type="button"
            className={`cal-day${marks}`}
            aria-label={`${date.label()}${status === "done" ? ", worked out" : status === "missed" ? ", missed" : ""}`}
            aria-pressed={selected ? isSelected : undefined}
            onClick={() => onPick(date)}
          >
            {date.day}
            {dot}
          </button>
        ) : (
          <span key={date.toString()} className={`month-day${marks}`}>
            {date.day}
            {dot}
          </span>
        );
      })}
    </>
  );
}

/** Every date of the month `anyDay` is in. */
export function datesOfMonth(anyDay: LocalDate): LocalDate[] {
  const { year, month } = anyDay;
  return Array.from({ length: LocalDate.daysInMonth(year, month) }, (_, i) => LocalDate.of(year, month, i + 1));
}
