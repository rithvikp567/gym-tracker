import { useEffect, useState } from "react";
import { LocalDate, MONTH_LONG, WEEKDAY_LETTER } from "../../domain/LocalDate";
import type { CalendarDay } from "../../services/CalendarService";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/controls";
import { useViewState } from "../hooks/useViewState";
import { href, navigate } from "../router";
import { useLive, useServices } from "../ServicesContext";

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

  const data = useLive(async () => {
    const [days, workoutDays] = await Promise.all([calendar.year(year), setup.days()]);
    return { days, workoutDays };
  }, [year, today.toString()]);

  const workouts = data?.days.filter((d) => d.status === "done").length ?? 0;
  const months = Array.from({ length: 12 }, (_, m) => data?.days.filter((d) => d.date.month === m + 1) ?? []);
  const nameOf = (id: string) => data?.workoutDays.find((d) => d.id === id)?.name ?? "Workout";

  const open = (day: CalendarDay) => {
    const logged = day.sessions.filter((s) => s.hasContent());
    if (logged.length === 1) navigate({ name: "session", dayId: logged[0]!.workoutDayId, date: day.date.toString() });
    else setPicked(day);
  };

  return (
    <>
      <header className="screen-head">
        <div className="year-switch">
          <a className="icon-btn" href={href({ name: "calendar", year: year - 1 })} aria-label="Previous year">
            <Icon name="left" />
          </a>
          <span className="year num">{year}</span>
          <a className="icon-btn" href={href({ name: "calendar", year: year + 1 })} aria-label="Next year">
            <Icon name="right" />
          </a>
        </div>
        <div className="sub num" style={{ alignSelf: "center" }}>
          {workouts} workout{workouts === 1 ? "" : "s"}
        </div>
      </header>

      <div className="legend">
        <span>
          <span className="dot done" /> Workout
        </span>
        <span>
          <span className="dot missed" /> Missed planned day
        </span>
      </div>

      <div className="months">
        {months.map((days, m) => (
          <section className="month" key={m} aria-label={MONTH_LONG[m]}>
            <h3>{MONTH_LONG[m]}</h3>
            <div className="month-grid">
              {WEEKDAY_LETTER.map((l, i) => (
                <span className="wd" key={i}>
                  {l}
                </span>
              ))}
              {days.length > 0 && Array.from({ length: days[0]!.date.weekday() }, (_, i) => <span key={`pad${i}`} />)}
              {days.map((d) => (
                <button
                  key={d.date.toString()}
                  type="button"
                  className={`cal-day${d.date.equals(today) ? " today" : ""}${d.date.isAfter(today) ? " future" : ""}`}
                  aria-label={`${d.date.label()}${d.status === "done" ? ", worked out" : d.status === "missed" ? ", missed" : ""}`}
                  onClick={() => open(d)}
                >
                  {d.date.day}
                  <span className="dot-slot">{(d.status === "done" || d.status === "missed") && <span className={`dot ${d.status}`} />}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {picked && data && (
        <Sheet title={picked.date.label()} onClose={() => setPicked(null)}>
          <DayDetails day={picked} nameOf={nameOf} workoutDays={data.workoutDays.map((d) => ({ id: d.id, name: d.name }))} />
        </Sheet>
      )}
    </>
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
