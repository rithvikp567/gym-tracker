import { LocalDate, MONTH_SHORT, WEEKDAY_LETTER } from "../../domain/LocalDate";
import type { WorkoutDay } from "../../domain/WorkoutDay";
import { Icon } from "../components/Icon";
import { ScreenHead } from "../components/controls";
import { useViewState } from "../hooks/useViewState";
import { href } from "../router";
import { useLive, useServices, useSyncStatus } from "../ServicesContext";

/** "Upper 1" → "U1", "Abs/Cardio" → "AC", "Lower" → "Lower". */
export function shortName(name: string): string {
  if (name.length <= 5) return name;
  const words = name.split(/[\s/]+/).filter(Boolean);
  if (words.length < 2) return name.slice(0, 4);
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase())).join("");
}

export function HomeScreen() {
  const { setup, calendar, sessions } = useServices();
  const today = calendar.today();
  // The picked day survives a trip to another tab; a day outside this week falls back to today.
  const [selected, setSelected] = useViewState<string | null>("home.day", () => null);

  const data = useLive(async () => {
    const [days, week] = await Promise.all([setup.days(), calendar.week(today)]);
    const lastDone = new Map<string, LocalDate>();
    for (const d of days) {
      const past = (await sessions.history(d.id)).filter((s) => s.isWorkout() && !s.date.isAfter(today));
      const last = past.at(-1);
      if (last) lastDone.set(d.id, last.date);
    }
    return { days, week, lastDone };
  }, [today.toString()]);

  if (!data) return <div className="loading">Loading…</div>;
  if (!data.days.length) return <FirstRun />;

  const weekStart = data.week[0]!.date;
  const weekEnd = data.week[6]!.date;
  const selectedDay = data.week.find((d) => d.date.toString() === selected) ?? data.week.find((d) => d.date.equals(today))!;
  const dayName = (id: string | null) => data.days.find((d) => d.id === id)?.name ?? "";

  return (
    <div className="home">
      <ScreenHead
        title="This week"
        sub={
          <span className="num">
            {MONTH_SHORT[weekStart.month - 1]} {weekStart.day} – {weekEnd.month !== weekStart.month ? `${MONTH_SHORT[weekEnd.month - 1]} ` : ""}
            {weekEnd.day} · Week {today.isoWeek()}
          </span>
        }
        actions={<SyncChip />}
      />

      <div className="week-strip" role="group" aria-label="Pick a day">
        {data.week.map((d) => (
          <button
            key={d.date.toString()}
            type="button"
            className={`week-day${d.date.equals(today) ? " today" : ""}`}
            aria-pressed={d.date.toString() === selectedDay.date.toString()}
            aria-label={`${d.date.label()}${d.status === "done" ? ", worked out" : d.status === "missed" ? ", missed" : ""}`}
            onClick={() => setSelected(d.date.toString())}
          >
            <span className="wd">{WEEKDAY_LETTER[d.date.weekday()]}</span>
            <span className="dn num">{d.date.day}</span>
            <span className="plan">{d.plannedDayId ? shortName(dayName(d.plannedDayId)) : ""}</span>
            <span className="dot-slot">
              {(d.status === "done" || d.status === "missed") && <span className={`dot ${d.status}`} />}
            </span>
          </button>
        ))}
      </div>

      <div className="section-title centered">
        <span>{selectedDay.date.equals(today) ? "Today" : selectedDay.date.label()}</span>
        <a className="link" href={href({ name: "setup" })}>
          Edit days
        </a>
      </div>

      <div className="list">
        {data.days.map((day) => (
          <DayRow
            key={day.id}
            day={day}
            date={selectedDay.date}
            planned={selectedDay.plannedDayId === day.id}
            logged={selectedDay.sessions.find((s) => s.workoutDayId === day.id)?.isWorkout() ?? false}
            lastDone={data.lastDone.get(day.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DayRow({
  day,
  date,
  planned,
  logged,
  lastDone,
}: {
  day: WorkoutDay;
  date: LocalDate;
  planned: boolean;
  logged: boolean;
  lastDone: LocalDate | undefined;
}) {
  const count = day.activeExercises().length;
  return (
    <a className="list-row day-row" href={href({ name: "session", dayId: day.id, date: date.toString() })}>
      {/* Empty left column the same width as the icons on the right keeps the text truly centered. */}
      <span className="side" aria-hidden />
      <div className="grow">
        <div className="title">
          {day.name} {planned && <span className="tag-planned">· Planned</span>}
        </div>
        <div className="meta num">
          {count} exercise{count === 1 ? "" : "s"}
          {lastDone ? ` · last ${lastDone.shortLabel()}` : " · not logged yet"}
        </div>
      </div>
      <span className="side end">
        {logged && (
          <span className="check-mark" aria-label="Logged">
            <Icon name="check" size={20} />
          </span>
        )}
        <span className="chev">
          <Icon name="right" size={18} />
        </span>
      </span>
    </a>
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
