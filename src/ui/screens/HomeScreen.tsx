import { useEffect, useLayoutEffect, useRef } from "react";
import { LocalDate, WEEKDAY_LETTER } from "../../domain/LocalDate";
import type { CalendarDay } from "../../services/CalendarService";
import { Icon } from "../components/Icon";
import { WorkoutRows } from "../components/WorkoutRows";
import { useViewState } from "../hooks/useViewState";
import { useSwipe } from "../hooks/useSwipe";
import { HOME_PICK_KEY, homePick, homeWeek, weekRangeLabel, type HomePick } from "../homePick";
import { play } from "../motion";
import { href } from "../router";
import { prefetchLive, useLive, useLiveState, useServices, useSyncStatus } from "../ServicesContext";

/** "Upper 1" → "U1", "Abs/Cardio" → "AC", "Lower" → "Lower". */
function shortName(name: string): string {
  if (name.length <= 5) return name;
  const words = name.split(/[\s/]+/).filter(Boolean);
  if (words.length < 2) return name.slice(0, 4);
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase())).join("");
}

function weekTitle(offset: number): string {
  // Title case, like a heading ("Last Week"), as the user asked.
  if (offset === 0) return "This Week";
  if (offset === -1) return "Last Week";
  if (offset === 1) return "Next Week";
  return offset < 0 ? `${-offset} Weeks Ago` : `In ${offset} Weeks`;
}

export function HomeScreen() {
  const services = useServices();
  const { setup, calendar, sessions } = services;
  const today = calendar.today();
  const [pick, setPick] = useViewState<HomePick | null>(HOME_PICK_KEY, () => null);
  const picked = (pick && pick.on === today.toString() ? LocalDate.tryParse(pick.date) : null) ?? today;
  const weekStart = picked.startOfWeek();
  const offset = today.startOfWeek().daysUntil(weekStart) / 7;
  const choose = (date: LocalDate) => setPick(homePick(date, today));

  const days = useLiveState(() => setup.days(), [], "days");
  // Loaded on its own, so a week step reloads only the week.
  const lastDone = useLive(() => sessions.lastWorkoutDates(today), [today.toString()], "lastDone");
  const shown = homeWeek(calendar, weekStart, today);
  const week = useLiveState(shown.load, shown.deps, shown.cacheAs);
  // Plan labels and dots come only from this week's own data.
  const thisWeek = week.value?.[0]?.date.equals(weekStart) ? week.value : undefined;

  // With a week on screen, load the weeks either side, so a step there draws at once.
  useEffect(() => {
    if (!thisWeek) return;
    for (const start of [weekStart.addDays(-7), weekStart.addDays(7)]) {
      const next = homeWeek(calendar, start, today);
      void prefetchLive(services, next.cacheAs, next.deps, next.load);
    }
    // Runs for each week that lands (and each reload after a change); the rest follows from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisWeek]);

  // Only the very first time, before anything is cached. A week step never ends up here.
  if (!days.value) return <div className="loading">Loading…</div>;
  // Only from fresh data: a copy from before you set up your days would still say there are none.
  if (!days.value.length && days.fresh) return <FirstRun />;

  const workoutDays = days.value;
  const dayName = (id: string | null) => workoutDays.find((d) => d.id === id)?.name ?? "";
  // The header and strip come from the dates alone (D26), so nothing waits for the week to load.
  const dates = Array.from({ length: 7 }, (_, i) => weekStart.addDays(i));
  // The rows keep the week last on screen (even one that came from the cache) until this one
  // lands. A week step keeps the weekday, so the plan still matches; the checks catch up when
  // the week arrives.
  const rowsDay = (thisWeek ?? week.previous)?.find((d) => d.date.weekday() === picked.weekday());

  return (
    <div className="home">
      {/* The week is the page's title: ‹ › around it, the strip under it, all on one tile. */}
      <section className="tile week-tile" aria-label="Week">
        <header className="week-head">
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => choose(picked.addDays(-7))}>
            <Icon name="left" size={20} />
          </button>
          <div className="week-title">
            <h1>{weekTitle(offset)}</h1>
            {/* If it can't fit on one line (a New Year week on a phone), only the week number wraps. */}
            <div className="sub num">
              <span>{weekRangeLabel(weekStart, today)}</span> <span>| Week {weekStart.isoWeek()}</span>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Next week" onClick={() => choose(picked.addDays(7))}>
            <Icon name="right" size={20} />
          </button>
        </header>

        <WeekStrip
          dates={dates}
          week={thisWeek}
          today={today}
          picked={picked}
          dayName={dayName}
          onPick={choose}
          onPrevWeek={() => choose(picked.addDays(-7))}
          onNextWeek={() => choose(picked.addDays(7))}
        />
      </section>

      {/* The picked day in the middle; "Today" (back to it) on the left, "Edit days" on the right. */}
      <div className="section-title centered">
        <span>
          {!picked.equals(today) && (
            <button type="button" className="link" onClick={() => choose(today)}>
              Today
            </button>
          )}
        </span>
        <span>{picked.equals(today) ? "Today" : picked.label()}</span>
        <a className="link" href={href({ name: "setup" })}>
          Edit days
        </a>
      </div>
      <WorkoutRows
        days={workoutDays}
        date={picked}
        plannedDayId={rowsDay?.plannedDayId ?? null}
        sessions={rowsDay?.sessions ?? []}
        lastDone={lastDone}
        busy={!thisWeek || !lastDone}
      />

      <div className="home-foot">
        <SyncChip />
      </div>
    </div>
  );
}

/** Mon–Sun with the planned workout and a green/red dot. Swipe sideways for another week. */
function WeekStrip({
  dates,
  week,
  today,
  picked,
  dayName,
  onPick,
  onPrevWeek,
  onNextWeek,
}: {
  /** The 7 dates, Monday first. */
  dates: readonly LocalDate[];
  /** The same week's plan and dots; undefined while it loads (the dates still show). */
  week: readonly CalendarDay[] | undefined;
  today: LocalDate;
  picked: LocalDate;
  dayName: (id: string | null) => string;
  onPick: (date: LocalDate) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useSwipe(strip, { onSwipeRight: onPrevWeek, onSwipeLeft: onNextWeek });
  // Another week slides in from its side. The same 7 buttons stay (no remount), so it's played
  // from code when the week changes rather than by a CSS animation on mount.
  const shownWeek = useRef(dates[0]!);
  useLayoutEffect(() => {
    const from = shownWeek.current;
    shownWeek.current = dates[0]!;
    if (from.equals(dates[0]!)) return;
    const side = dates[0]!.isBefore(from) ? -1 : 1;
    play(strip.current, [{ transform: `translateX(${side * 24}px)`, opacity: 0.35 }, { transform: "none", opacity: 1 }], 220);
  });
  return (
    <div className="week-strip" role="group" aria-label="Pick a day" aria-busy={week ? undefined : true} ref={strip}>
      {dates.map((date, i) => {
        const d = week?.find((x) => x.date.equals(date));
        const status = d?.status;
        return (
          // Keyed by weekday: a week step updates the same 7 buttons instead of replacing them.
          <button
            key={i}
            type="button"
            className={`week-day${date.equals(today) ? " today" : ""}`}
            aria-pressed={date.equals(picked)}
            aria-label={`${date.label()}${status === "done" ? ", worked out" : status === "missed" ? ", missed" : ""}`}
            onClick={() => onPick(date)}
          >
            <span className="wd">{WEEKDAY_LETTER[date.weekday()]}</span>
            <span className="dn num">{date.day}</span>
            <span className="plan">{d?.plannedDayId ? shortName(dayName(d.plannedDayId)) : ""}</span>
            <span className="dot-slot">{(status === "done" || status === "missed") && <span className={`dot ${status}`} />}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sync status (or "Demo data") under the rows. When sync is set up, its slot is kept even while
 * there's nothing to say yet (sign-in finishes after Home draws, sometimes after a token refresh),
 * so the chip appearing never makes the page taller and moves the centered strip.
 */
function SyncChip() {
  const { mode } = useServices();
  const status = useSyncStatus();
  if (mode === "demo") return <span className="chip">Demo data</span>;
  const text: Record<typeof status.state, string | null> = {
    off: null,
    "signed-out": null,
    idle: "Synced",
    syncing: "Syncing…",
    offline: "Offline",
    error: "Sync error",
  };
  const label = text[status.state];
  if (!label) return status.state === "off" ? null : <span className="chip is-placeholder" aria-hidden>{"\u00a0"}</span>;
  return (
    <a className="chip" href={href({ name: "settings" })}>
      <span className={`dot ${status.state === "error" ? "missed" : status.state === "idle" ? "done" : ""}`} />
      {label}
    </a>
  );
}

function FirstRun() {
  return (
    <div className="empty">
      <Icon name="barbell" size={40} />
      <h1>Let's set up your week</h1>
      <p>Import your Google Sheet to bring your history over, or create your workout days from scratch.</p>
      <a className="btn primary block" style={{ maxWidth: 320 }} href={href({ name: "import" })}>
        <Icon name="upload" size={18} /> Import from Google Sheets
      </a>
      <a className="btn block" style={{ maxWidth: 320 }} href={href({ name: "setup" })}>
        Set up workout days
      </a>
      <a className="link" href="?demo">
        Preview with sample data
      </a>
    </div>
  );
}
