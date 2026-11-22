import { useRef } from "react";
import { LocalDate, MONTH_SHORT, WEEKDAY_LETTER } from "../../domain/LocalDate";
import type { CalendarDay } from "../../services/CalendarService";
import { CenterBlock } from "../components/CenterBlock";
import { Icon } from "../components/Icon";
import { WorkoutRows } from "../components/WorkoutRows";
import { useViewState } from "../hooks/useViewState";
import { useSwipe } from "../hooks/useSwipe";
import { HOME_PICK_KEY, homePick, type HomePick } from "../homePick";
import { href } from "../router";
import { useLive, useServices, useSyncStatus } from "../ServicesContext";

/** "Upper 1" → "U1", "Abs/Cardio" → "AC", "Lower" → "Lower". */
function shortName(name: string): string {
  if (name.length <= 5) return name;
  const words = name.split(/[\s/]+/).filter(Boolean);
  if (words.length < 2) return name.slice(0, 4);
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase())).join("");
}

function weekTitle(offset: number): string {
  if (offset === 0) return "This week";
  if (offset === -1) return "Last week";
  if (offset === 1) return "Next week";
  return offset < 0 ? `${-offset} weeks ago` : `In ${offset} weeks`;
}

export function HomeScreen() {
  const { setup, calendar, sessions } = useServices();
  const today = calendar.today();
  const [pick, setPick] = useViewState<HomePick | null>(HOME_PICK_KEY, () => null);
  const picked = (pick && pick.on === today.toString() ? LocalDate.tryParse(pick.date) : null) ?? today;
  const weekStart = picked.startOfWeek();
  const offset = today.startOfWeek().daysUntil(weekStart) / 7;
  const choose = (date: LocalDate) => setPick(homePick(date, today));

  const days = useLive(() => setup.days(), [], "days");
  const data = useLive(
    async () => {
      const [week, lastDone] = await Promise.all([calendar.week(weekStart), sessions.lastWorkoutDates(today)]);
      return { week, lastDone };
    },
    [weekStart.toString(), today.toString()],
    "home",
  );

  if (days && !days.length) return <FirstRun />;
  if (!days || !data) return <div className="loading">Loading…</div>;

  const weekEnd = weekStart.addDays(6);
  const pickedDay = data.week.find((d) => d.date.equals(picked)) ?? data.week[0]!;
  const dayName = (id: string | null) => days.find((d) => d.id === id)?.name ?? "";
  const otherYear = weekStart.year !== today.year ? `, ${weekStart.year}` : "";

  return (
    <div className="home page-fill">
      <header className="screen-head home-head">
        <div>
          <h1>{weekTitle(offset)}</h1>
          <div className="sub num">
            {MONTH_SHORT[weekStart.month - 1]} {weekStart.day} – {weekEnd.month !== weekStart.month ? `${MONTH_SHORT[weekEnd.month - 1]} ` : ""}
            {weekEnd.day}
            {otherYear} | Week {weekStart.isoWeek()}
          </div>
        </div>
        <div className="home-head-side">
          <SyncChip />
          <div className="week-nav" role="group" aria-label="Week">
            {offset !== 0 && (
              <button type="button" className="link" onClick={() => choose(today)}>
                Today
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => choose(picked.addDays(-7))}>
              <Icon name="left" size={20} />
            </button>
            <button type="button" className="icon-btn" aria-label="Next week" onClick={() => choose(picked.addDays(7))}>
              <Icon name="right" size={20} />
            </button>
          </div>
        </div>
      </header>

      <WeekStrip
        week={data.week}
        today={today}
        picked={pickedDay.date}
        dayName={dayName}
        onPick={choose}
        onPrevWeek={() => choose(picked.addDays(-7))}
        onNextWeek={() => choose(picked.addDays(7))}
      />

      <CenterBlock>
        <div className="section-title centered">
          <span>{pickedDay.date.equals(today) ? "Today" : pickedDay.date.label()}</span>
          <a className="link" href={href({ name: "setup" })}>
            Edit days
          </a>
        </div>
        <WorkoutRows days={days} date={pickedDay.date} plannedDayId={pickedDay.plannedDayId} sessions={pickedDay.sessions} lastDone={data.lastDone} />
      </CenterBlock>
    </div>
  );
}

/** Mon–Sun with the planned workout and a green/red dot. Swipe sideways for another week. */
function WeekStrip({
  week,
  today,
  picked,
  dayName,
  onPick,
  onPrevWeek,
  onNextWeek,
}: {
  week: CalendarDay[];
  today: LocalDate;
  picked: LocalDate;
  dayName: (id: string | null) => string;
  onPick: (date: LocalDate) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useSwipe(strip, { onSwipeRight: onPrevWeek, onSwipeLeft: onNextWeek });
  return (
    <div className="week-strip" role="group" aria-label="Pick a day" ref={strip}>
      {week.map((d) => (
        <button
          key={d.date.toString()}
          type="button"
          className={`week-day${d.date.equals(today) ? " today" : ""}`}
          aria-pressed={d.date.equals(picked)}
          aria-label={`${d.date.label()}${d.status === "done" ? ", worked out" : d.status === "missed" ? ", missed" : ""}`}
          onClick={() => onPick(d.date)}
        >
          <span className="wd">{WEEKDAY_LETTER[d.date.weekday()]}</span>
          <span className="dn num">{d.date.day}</span>
          <span className="plan">{d.plannedDayId ? shortName(dayName(d.plannedDayId)) : ""}</span>
          <span className="dot-slot">{(d.status === "done" || d.status === "missed") && <span className={`dot ${d.status}`} />}</span>
        </button>
      ))}
    </div>
  );
}

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
  return label ? (
    <a className="chip" href={href({ name: "settings" })}>
      <span className={`dot ${status.state === "error" ? "missed" : status.state === "idle" ? "done" : ""}`} />
      {label}
    </a>
  ) : null;
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
