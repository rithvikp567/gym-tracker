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
}: {
  days: readonly WorkoutDay[];
  date: LocalDate;
  plannedDayId: string | null;
  /** Sessions on `date`. */
  sessions: readonly Session[];
  lastDone: ReadonlyMap<string, LocalDate>;
}) {
  return (
    <div className="list">
      {days.map((day) => (
        <DayRow
          key={day.id}
          day={day}
          date={date}
          planned={plannedDayId === day.id}
          logged={sessions.find((s) => s.workoutDayId === day.id)?.isWorkout() ?? false}
          lastDone={lastDone.get(day.id)}
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
