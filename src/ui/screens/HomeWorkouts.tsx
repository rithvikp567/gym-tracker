import type { CSSProperties } from "react";
import type { LocalDate } from "../../domain/LocalDate";
import type { Session } from "../../domain/Session";
import type { WorkoutDay } from "../../domain/WorkoutDay";
import { Icon } from "../components/Icon";
import { STALE_AFTER_MS } from "../components/WorkoutRows";
import { useLasting } from "../hooks/useLasting";
import { href } from "../router";

/**
 * Home under the picked day's title: that day's workout as one big tile with its Start button
 * (what was logged that day, else what's planned), and every other workout as a small square
 * with just its name (D47).
 */
export function HomeWorkouts({
  days,
  date,
  today,
  plannedDayId,
  sessions,
  lastDone,
  known,
  busy,
}: {
  days: readonly WorkoutDay[];
  date: LocalDate;
  today: LocalDate;
  plannedDayId: string | null;
  /** Sessions on `date`. */
  sessions: readonly Session[];
  /** When each workout day was last done; undefined while that's still loading. */
  lastDone: ReadonlyMap<string, LocalDate> | undefined;
  /** False until a week (this one or the one last on screen) has loaded: the plan isn't known yet. */
  known: boolean;
  /** The plan and checks are from older data while newer loads (see WorkoutRows). */
  busy: boolean;
}) {
  const stale = useLasting(busy, STALE_AFTER_MS);
  const logged = (day: WorkoutDay) => sessions.some((s) => s.workoutDayId === day.id && s.isWorkout());
  const featured = known ? (days.find(logged) ?? days.find((day) => day.id === plannedDayId)) : undefined;
  const others = featured ? days.filter((day) => day !== featured) : days;
  return (
    <div className="home-workouts" aria-busy={busy || undefined} data-stale={stale || undefined}>
      {featured ? (
        <Hero day={featured} date={date} today={today} logged={logged(featured)} lastDone={lastDone} />
      ) : (
        <RestHero placeholder={!known} />
      )}
      {others.length > 0 && (
        <>
          <div className="section-title centered">
            <span />
            <span>{featured ? "Other workouts" : "Workouts"}</span>
            <span />
          </div>
          <div className="square-grid" style={gridColumns(others.length)}>
            {others.map((day) => (
              <a key={day.id} className="tile square workout-tile" href={href({ name: "session", dayId: day.id, date: date.toString() })}>
                <span className="name">{day.name}</span>
                {logged(day) && (
                  <span className="check-mark" aria-label="Logged">
                    <Icon name="check" size={18} />
                  </span>
                )}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Squares per row: as many as there are up to 3 on a phone (4 as 2 × 2), up to 4 on a wider
 * screen. A short last row is centered.
 */
function gridColumns(n: number): CSSProperties {
  const phone = n <= 3 ? n : n === 4 ? 2 : 3;
  const wide = n <= 4 ? n : n <= 6 ? 3 : 4;
  return { "--n": phone, "--n-wide": wide } as CSSProperties;
}

function Hero({
  day,
  date,
  today,
  logged,
  lastDone,
}: {
  day: WorkoutDay;
  date: LocalDate;
  today: LocalDate;
  logged: boolean;
  lastDone: ReadonlyMap<string, LocalDate> | undefined;
}) {
  const count = day.activeExercises().length;
  const last = lastDone ? (lastDone.get(day.id) ?? null) : undefined;
  const action = logged ? "Open" : date.isBefore(today) ? "Log" : "Start";
  return (
    <a className="tile hero workout-tile" href={href({ name: "session", dayId: day.id, date: date.toString() })}>
      <div className="hero-text">
        <div className="name">
          {day.name}
          {logged && (
            <span className="check-mark" aria-label="Logged">
              <Icon name="check" size={20} />
            </span>
          )}
        </div>
        <div className="meta num">
          {count} exercise{count === 1 ? "" : "s"}
          {/* Logged that day: the check says it, and "last" could be a later date. */}
          {logged ? "" : last ? ` · last ${last.shortLabel()}` : last === null ? " · not logged yet" : ""}
        </div>
      </div>
      <span className="btn primary hero-go">{action}</span>
    </a>
  );
}

/** Nothing planned or logged. Before any week has loaded, the same tile with nothing in it holds the space. */
function RestHero({ placeholder }: { placeholder: boolean }) {
  return (
    <div className={`tile hero rest${placeholder ? " is-placeholder" : ""}`} aria-hidden={placeholder || undefined}>
      <div className="hero-text">
        <div className="name">Rest day</div>
        <div className="meta">Nothing planned</div>
      </div>
    </div>
  );
}
