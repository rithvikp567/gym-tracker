import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { LocalDate, MONTH_LONG } from "../../domain/LocalDate";
import type { CalendarDay } from "../../services/CalendarService";
import { useHoldBriefly } from "../components/CenterBlock";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/controls";
import { datesOfMonth, MonthCells, type DayMark } from "../components/MonthCells";
import { useViewState } from "../hooks/useViewState";
import { boxOf, canAnimate, easeOut, growKeyframes, prefersReducedMotion } from "../motion";
import { href, navigate } from "../router";
import { useLive, useServices } from "../ServicesContext";
import type { SlideDirection } from "../slide";

/** Every date of a year, grouped by month (Jan = 0). Drawn before the data loads so nothing jumps. */
function monthsOf(year: number): LocalDate[][] {
  return Array.from({ length: 12 }, (_, m) => datesOfMonth(LocalDate.of(year, m + 1, 1)));
}

/** The month popped out of the year view (Jan = 0). */
interface OpenMonth {
  year: number;
  month: number;
}

/**
 * Year view: 12 months, a green dot for every workout, red for a missed planned day. A month is
 * one button: it pops out bigger over the page, and its dates are the ones to tap. A tap outside
 * (or Escape) closes one layer at a time: a date's sheet first, then the month.
 */
export function CalendarScreen({ year: routeYear }: { year: number | null }) {
  const { calendar, setup } = useServices();
  const today = calendar.today();
  // The Calendar tab links to #/calendar with no year: come back to the year you were looking at.
  const [lastYear, setLastYear] = useViewState<number | null>("calendar.year", () => null);
  const year = routeYear ?? lastYear ?? today.year;
  // The popped-out month is kept the same way, so Back from a session it opened brings it back.
  const [openMonth, setOpenMonth] = useViewState<OpenMonth | null>("calendar.month", () => null);
  const popped = openMonth?.year === year ? openMonth.month : null;
  useEffect(() => {
    if (year !== lastYear) setLastYear(year);
    // Another year closes it (and coming back to this year doesn't bring it back).
    if (openMonth && openMonth.year !== year) setOpenMonth(null);
  }, [year, lastYear, setLastYear, openMonth, setOpenMonth]);
  const [picked, setPicked] = useState<CalendarDay | null>(null);
  const holdBriefly = useHoldBriefly();
  // A year switch slides the months in from the side it came from (‹ from the left, › from the right).
  const [shown, setShown] = useState<{ year: number; slide: SlideDirection | null }>({ year, slide: null });
  if (shown.year !== year) setShown({ year, slide: year < shown.year ? "back" : "forward" });
  /** The month tiles, for the pop-out to grow from and to give focus back to. */
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  /** The tile just tapped: the pop-out grows out of it (one brought back by Back just fades in). */
  const growFrom = useRef<HTMLElement | null>(null);

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
  const statusOf = (date: LocalDate) => byDate.get(date.toString())?.status;

  const open = (date: LocalDate) => {
    const day = byDate.get(date.toString());
    if (!day) return; // still loading
    const logged = day.sessions.filter((s) => s.hasContent());
    if (logged.length === 1) navigate({ name: "session", dayId: logged[0]!.workoutDayId, date: day.date.toString() });
    else setPicked(day);
  };
  const closeMonth = useCallback(() => setOpenMonth(null), [setOpenMonth]);
  const closeDay = useCallback(() => setPicked(null), []);

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
        <div className="cal-count sub num">{data ? `${workouts} workout${workouts === 1 ? "" : "s"}` : " "}</div>
        <div className="legend">
          <span>
            <span className="dot done" /> Workout
          </span>
          <span>
            <span className="dot missed" /> Missed planned day
          </span>
        </div>
      </header>

      {/* Each month is one button (inside a button only phrasing content is allowed: spans). */}
      <div key={year} className={`months${shown.slide ? ` slide-${shown.slide}` : ""}`}>
        {months.map((dates, m) => (
          <button
            key={m}
            ref={(el) => {
              tiles.current[m] = el;
            }}
            type="button"
            className="tile month"
            aria-label={`${MONTH_LONG[m]} ${year}`}
            aria-haspopup="dialog"
            onClick={(e) => {
              growFrom.current = e.currentTarget;
              setOpenMonth({ year, month: m });
            }}
          >
            <span className="month-name">{MONTH_LONG[m]}</span>
            <span className="month-grid">
              <MonthCells dates={dates} today={today} statusOf={statusOf} />
            </span>
          </button>
        ))}
      </div>

      {popped !== null && (
        <MonthPop
          key={`${year}-${popped}`}
          title={`${MONTH_LONG[popped]} ${year}`}
          dates={months[popped]!}
          today={today}
          statusOf={statusOf}
          covered={picked !== null}
          tile={() => tiles.current[popped] ?? null}
          growFrom={growFrom}
          onPick={open}
          onClose={closeMonth}
        />
      )}

      {/* After the month in <body>, and a layer above it (z-index): a tap on its backdrop closes only the sheet. */}
      {picked && data && (
        <Sheet title={picked.date.label()} onClose={closeDay}>
          <DayDetails day={picked} nameOf={nameOf} workoutDays={data.workoutDays.map((d) => ({ id: d.id, name: d.name }))} />
        </Sheet>
      )}
    </div>
  );
}

/** How long the month takes to grow out of its tile (or fade in). */
const POP_MS = 220;

/**
 * A month, big, over the page: a dialog drawn into <body> (like Sheet: the page moves while it
 * animates, and a moving block traps `position: fixed`), so opening it moves nothing. It grows
 * out of its tile; under Reduce Motion, or brought back by Back, it fades in.
 *
 * Closing: a tap on the dim layer around it (the layer has no children, so a press that starts
 * on the month and is let go outside clicks their common parent, not the layer), or Escape.
 * While a date's sheet is open (`covered`) both belong to the sheet: its backdrop covers this
 * layer, and this one stops listening for Escape, so one press closes one layer.
 */
function MonthPop({
  title,
  dates,
  today,
  statusOf,
  covered,
  tile,
  growFrom,
  onPick,
  onClose,
}: {
  title: string;
  dates: LocalDate[];
  today: LocalDate;
  statusOf: (date: LocalDate) => DayMark;
  covered: boolean;
  /** The month's tile in the year view: focus goes back to it on close. */
  tile: () => HTMLElement | null;
  /** The tile it was opened from, if it was just tapped (read once, then cleared). */
  growFrom: { current: HTMLElement | null };
  onPick: (date: LocalDate) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const scrim = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [from] = useState(() => growFrom.current);

  // In before the first paint: focus moves into the month, and it grows out of its tile.
  useLayoutEffect(() => {
    growFrom.current = null;
    const d = dialog.current;
    if (!d) return;
    d.focus({ preventScroll: true });
    const animations = popIn(scrim.current, d, from);
    return () => {
      animations.forEach((a) => a.cancel());
      tile()?.focus({ preventScroll: true });
    };
    // Once, when it opens (`tile` and `growFrom` only matter then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (covered) return; // the sheet on top closes first, with its own Escape listener
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered, onClose]);

  return createPortal(
    <div className="month-pop-layer">
      <div className="month-pop-scrim" ref={scrim} aria-hidden onClick={onClose} />
      <div
        ref={dialog}
        className="tile month-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={covered ? undefined : keepFocusIn}
      >
        <h2 id={titleId} className="month-pop-title">
          {title}
        </h2>
        <div className="month-grid">
          <MonthCells dates={dates} today={today} statusOf={statusOf} onPick={onPick} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Tab and Shift+Tab go round the month's dates instead of out to the page behind it. */
function keepFocusIn(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== "Tab") return;
  const buttons = e.currentTarget.querySelectorAll<HTMLElement>("button");
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;
  const at = document.activeElement;
  const wrapTo = e.shiftKey ? (at === first || at === e.currentTarget ? last : null) : at === last ? first : null;
  if (!wrapTo) return;
  e.preventDefault();
  wrapTo.focus();
}

/**
 * The dim layer fades in; the month grows from its tile's box to its own (`from`), or fades in
 * where there's no tile to grow from or under Reduce Motion (a fade isn't motion). Web
 * Animations, so base.css's Reduce Motion switch (CSS only) leaves the fade alone.
 */
function popIn(scrim: HTMLElement | null, dialog: HTMLElement, from: HTMLElement | null): Animation[] {
  if (!canAnimate(dialog)) return [];
  const timing = { duration: POP_MS, easing: easeOut(dialog) };
  const fade: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  const a = boxOf(from);
  const b = boxOf(dialog);
  const grow = a && b && !prefersReducedMotion() ? growKeyframes(a, b) : null;
  return [scrim?.animate(fade, timing), dialog.animate(grow ?? fade, timing)].filter((x): x is Animation => !!x);
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
