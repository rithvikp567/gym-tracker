import { useCallback, useRef, useState } from "react";
import { MONTH_LONG, type LocalDate } from "../../domain/LocalDate";
import { useLive, useServices } from "../ServicesContext";
import { Sheet, useSheetClose } from "./controls";
import { Icon } from "./Icon";
import { datesOfMonth, MonthCells } from "./MonthCells";

/**
 * The date pill on a workout or rest day ("Mon, Nov 23 | Week 48"). It opens the app's own date
 * picker, not the phone's: the Calendar's month (Monday first, today in the accent, workout and
 * missed dots) with the day you're on filled in the accent, ‹ › for other months, and Today (D55).
 */
export function DateField({ date, onPick }: { date: LocalDate; onPick: (date: LocalDate) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // A picked date waits for the sheet's closing animation: going there remounts the screen.
  const picked = useRef<LocalDate | null>(null);
  const closed = useCallback(() => {
    setOpen(false);
    const target = picked.current;
    picked.current = null;
    if (target) onPick(target);
  }, [onPick]);
  return (
    <>
      <button ref={button} type="button" className="date-picker num" aria-haspopup="dialog" aria-label={`${date.label()}, change date`} onClick={() => setOpen(true)}>
        {date.labelWithWeek()}
        <Icon name="down" size={14} />
      </button>
      {open && (
        <Sheet title="Pick a date" onClose={closed} growFrom={button.current} className="date-sheet" head={null}>
          <DatePicker date={date} onPick={(d) => (picked.current = d.equals(date) ? null : d)} />
        </Sheet>
      )}
    </>
  );
}

/** A month to pick from; picking one closes the sheet (`onPick` hears it first). */
function DatePicker({ date, onPick }: { date: LocalDate; onPick: (date: LocalDate) => void }) {
  const { calendar } = useServices();
  const close = useSheetClose();
  const today = calendar.today();
  const [month, setMonth] = useState(() => date.addDays(1 - date.day));
  const dates = datesOfMonth(month);
  const days = useLive(() => calendar.range(dates[0]!, dates[dates.length - 1]!), [month.toString(), today.toString()], "date-picker");
  const byDate = new Map(days?.map((d) => [d.date.toString(), d.status]) ?? []);

  const pick = (picked: LocalDate) => {
    onPick(picked);
    close();
  };

  return (
    <div className="date-picker-sheet">
      <div className="date-sheet-head">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(month.addMonths(-1))}>
          <Icon name="left" size={20} />
        </button>
        <h2 className="date-sheet-title" aria-live="polite">
          {MONTH_LONG[month.month - 1]} {month.year}
        </h2>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(month.addMonths(1))}>
          <Icon name="right" size={20} />
        </button>
      </div>
      <div className="month-grid">
        <MonthCells dates={dates} today={today} statusOf={(d) => byDate.get(d.toString())} selected={date} onPick={pick} />
      </div>
      <div className="date-sheet-foot">
        <button type="button" className="chip-btn" disabled={date.equals(today)} onClick={() => pick(today)}>
          Today
        </button>
      </div>
    </div>
  );
}
