import type { LocalDate } from "../../domain/LocalDate";
import type { Session } from "../../domain/Session";
import type { WorkoutDay } from "../../domain/WorkoutDay";
import { href } from "../router";
import { Icon } from "./Icon";

/**
 * Every workout day as a row for one date (Home, a rest day): name, "Planned", how many
 * exercises, when it was last done, and a check if it was logged that date.
 */
export function WorkoutRows({
  days,
  date,
  plannedDayId,
  sessions,
  lastDone,
  busy = false,
}: {
  days: readonly WorkoutDay[];
  date: LocalDate;
  plannedDayId: string | null;
  /** Sessions on `date`. */
  sessions: readonly Session[];
  /** When each workout day was last done; undefined while that's still loading. */
  lastDone: ReadonlyMap<string, LocalDate> | undefined;
  /** The plan and checks are from older data while newer loads (Home dims them if it takes a moment). */
  busy?: boolean;
}) {
  return (
    <div className="list" aria-busy={busy || undefined}>
      {days.map((day) => (
        <DayRow
          key={day.id}
          day={day}
          date={date}
          planned={plannedDayId === day.id}
          logged={sessions.find((s) => s.workoutDayId === day.id)?.isWorkout() ?? false}
          lastDone={lastDone ? (lastDone.get(day.id) ?? null) : undefined}
        />
      ))}
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
  /** null = never done; undefined = not known yet. */
  lastDone: LocalDate | null | undefined;
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
          {lastDone ? ` · last ${lastDone.shortLabel()}` : lastDone === null ? " · not logged yet" : ""}
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
