import { useEffect, useMemo, useState } from "react";
import { LocalDate, MONTH_LONG, WEEKDAY_LETTER } from "../../domain/LocalDate";
import type { CalendarDay } from "../../services/CalendarService";
import { useHoldBriefly } from "../components/CenterBlock";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/controls";
import { useViewState } from "../hooks/useViewState";
import { href, navigate } from "../router";
import { useLive, useServices } from "../ServicesContext";
import type { SlideDirection } from "../slide";

/** Every date of a year, grouped by month (Jan = 0). Drawn before the data loads so nothing jumps. */
function monthsOf(year: number): LocalDate[][] {
  return Array.from({ length: 12 }, (_, m) => Array.from({ length: LocalDate.daysInMonth(year, m + 1) }, (_, i) => LocalDate.of(year, m + 1, i + 1)));
}

/** Year view: 12 months, a green dot for every workout, red for a missed planned day. */
export function CalendarScreen({ year: routeYear }: { year: number | null }) {
  const { calendar, setup } = useServices();
  const today = calendar.today();
  // The Calendar tab links to #/calendar with no year: come back to the year you were looking at.
  const [lastYear, setLastYear] = useViewState<number | null>("calendar.year", () => null);
  const year = routeYear ?? lastYear ?? today.year;
  useEffect(() => {
    if (year !== lastYear) setLastYear(year);
  }, [year, lastYear, setLastYear]);
  const [picked, setPicked] = useState<CalendarDay | null>(null);
  const holdBriefly = useHoldBriefly();
  // A year switch slides the months in from the side it came from (‹ from the left, › from the right).
  const [shown, setShown] = useState<{ year: number; slide: SlideDirection | null }>({ year, slide: null });
  if (shown.year !== year) setShown({ year, slide: year < shown.year ? "back" : "forward" });

  const data = useLive(
    async () => {
      const [days, workoutDays] = await Promise.all([calendar.year(year), setup.days()]);
      return { days, workoutDays };
    },
    [year, today.toString()],
    "calendar",
  );

  // The grid comes from the dates alone; the data only adds dots, so the page never reflows.
  const months = useMemo(() => monthsOf(year), [year]);
  const byDate = useMemo(() => new Map(data?.days.map((d) => [d.date.toString(), d]) ?? []), [data]);
  const workouts = data?.days.filter((d) => d.status === "done").length ?? 0;
  const nameOf = (id: string) => data?.workoutDays.find((d) => d.id === id)?.name ?? "Workout";

  const open = (date: LocalDate) => {
    const day = byDate.get(date.toString());
    if (!day) return; // still loading
    const logged = day.sessions.filter((s) => s.hasContent());
    if (logged.length === 1) navigate({ name: "session", dayId: logged[0]!.workoutDayId, date: day.date.toString() });
    else setPicked(day);
  };

  return (
    <div className="calendar">
      {/* The year is the page's title: ‹ › around it, the count and the legend under it, on one tile. */}
      <header className="tile cal-head">
        <div className="year-switch">
          {/* Another year can be a row of weeks taller or shorter: the page holds its place for a moment. */}
          <a className="icon-btn" href={href({ name: "calendar", year: year - 1 })} aria-label="Previous year" onClick={holdBriefly}>
            <Icon name="left" />
          </a>
          <h1 className="year num">{year}</h1>
          <a className="icon-btn" href={href({ name: "calendar", year: year + 1 })} aria-label="Next year" onClick={holdBriefly}>
            <Icon name="right" />
          </a>
        </div>
        <div className="cal-count sub num">{data ? `${workouts} workout${workouts === 1 ? "" : "s"}` : "\u00a0"}</div>
        <div className="legend">
          <span>
            <span className="dot done" /> Workout
          </span>
          <span>
            <span className="dot missed" /> Missed planned day
          </span>
        </div>
      </header>

      <div key={year} className={`months${shown.slide ? ` slide-${shown.slide}` : ""}`}>
        {months.map((dates, m) => (
          <section className="tile month" key={m} aria-label={MONTH_LONG[m]}>
            <h3>{MONTH_LONG[m]}</h3>
            <div className="month-grid">
              {WEEKDAY_LETTER.map((l, i) => (
                <span className="wd" key={i}>
                  {l}
                </span>
              ))}
              {Array.from({ length: dates[0]!.weekday() }, (_, i) => (
                <span key={`pad${i}`} />
              ))}
              {dates.map((date) => {
                const status = byDate.get(date.toString())?.status;
                return (
                  <button
                    key={date.toString()}
                    type="button"
                    className={`cal-day${date.equals(today) ? " today" : ""}${date.isAfter(today) ? " future" : ""}`}
                    aria-label={`${date.label()}${status === "done" ? ", worked out" : status === "missed" ? ", missed" : ""}`}
                    onClick={() => open(date)}
                  >
                    {date.day}
                    <span className="dot-slot">{(status === "done" || status === "missed") && <span className={`dot ${status}`} />}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {picked && data && (
        <Sheet title={picked.date.label()} onClose={() => setPicked(null)}>
          <DayDetails day={picked} nameOf={nameOf} workoutDays={data.workoutDays.map((d) => ({ id: d.id, name: d.name }))} />
        </Sheet>
      )}
    </div>
  );
}

function DayDetails({
  day,
  nameOf,
  workoutDays,
}: {
  day: CalendarDay;
  nameOf: (id: string) => string;
  workoutDays: { id: string; name: string }[];
}) {
  const logged = day.sessions.filter((s) => s.hasContent());
  const date = day.date.toString();
  const planned = workoutDays.filter((w) => w.id === day.plannedDayId);
  const others = workoutDays.filter((w) => w.id !== day.plannedDayId && !logged.some((s) => s.workoutDayId === w.id));
  return (
    <div className="stack">
      {logged.length > 0 ? (
        <div className="list">
          {logged.map((s) => (
            <a key={s.id} className="list-row" href={href({ name: "session", dayId: s.workoutDayId, date })}>
              <div className="grow">
                <div className="title">{nameOf(s.workoutDayId)}</div>
                <div className="meta">{s.logs.filter((l) => l.hasResult()).length} exercises logged</div>
              </div>
              <Icon name="right" size={18} />
            </a>
          ))}
        </div>
      ) : (
        <p className="muted small">{day.status === "missed" ? "Planned, but nothing was logged." : "Nothing logged."}</p>
      )}
      {(planned.length > 0 || others.length > 0) && !LocalDate.parse(date).isAfter(LocalDate.today()) && (
        <>
          <div className="section-title" style={{ margin: "8px 0 0" }}>
            Log a workout for this day
          </div>
          <div className="list">
            {[...planned, ...others].map((w) => (
              <a key={w.id} className="list-row" href={href({ name: "session", dayId: w.id, date })}>
                <div className="grow title">
                  {w.name} {w.id === day.plannedDayId && <span className="tag-planned">· Planned</span>}
                </div>
                <Icon name="plus" size={18} />
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
