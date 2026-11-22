import { LocalDate } from "../../domain/LocalDate";
import { CenterBlock } from "../components/CenterBlock";
import { BackButton } from "../components/controls";
import { Icon } from "../components/Icon";
import { WorkoutRows } from "../components/WorkoutRows";
import { navigate } from "../router";
import { useLiveState, useServices } from "../ServicesContext";
import { useSlide } from "../slide";
import { rememberHomeDay } from "../homePick";
import { useDayStep } from "../hooks/useDayStep";
import { DayArrows } from "./session/DayArrows";

/**
 * A date with no single workout to open: a rest day, or several workouts logged. Lists your
 * workout days for that date; the ‹ › arrows keep stepping through days.
 */
export function DayScreen({ date: iso }: { date: string }) {
  const { setup, calendar, sessions } = useServices();
  const today = calendar.today();
  const date = LocalDate.tryParse(iso) ?? today;
  const slide = useSlide(`day/${iso}`);
  const stepDay = useDayStep(date, null);

  const daysLive = useLiveState(() => setup.days(), [], "days");
  const days = daysLive.value;
  const live = useLiveState(
    async () => {
      const [range, lastDone] = await Promise.all([calendar.range(date, date), sessions.lastWorkoutDates(today)]);
      return { info: range[0]!, lastDone };
    },
    [date.toString(), today.toString()],
    "day",
  );
  const data = live.value;

  const logged = data?.info.sessions.filter((s) => s.hasContent()).length ?? 0;
  const plannedName = days?.find((d) => d.id === data?.info.plannedDayId)?.name;
  // "Rest day" and "Pick a workout" say nothing was logged: only from fresh data, as a copy from
  // before you logged a workout here would say so by mistake. Until then they stay blank.
  const fresh = daysLive.fresh && live.fresh;
  const title = !data || !days ? "\u00a0" : logged > 0 ? "Workouts" : !fresh ? "\u00a0" : plannedName ? "Pick a workout" : "Rest day";
  const note =
    logged > 1
      ? `${logged} workouts logged`
      : logged === 1
        ? "1 workout logged"
        : !fresh
          ? "\u00a0"
          : plannedName
            ? `${plannedName} is planned`
            : date.isAfter(today)
              ? "Nothing planned"
              : "Nothing planned · log a workout?";

  return (
    <div className="session-screen page-fill">
      <div className="session-head">
        <BackButton fallback={{ name: "home" }} />
        <h1 className="session-name">{title}</h1>
        <span className="session-jumps" />
        <div className="session-sub">
          <label className="date-picker num">
            {date.labelWithWeek()}
            <Icon name="down" size={14} />
            <input
              type="date"
              aria-label="Change date"
              value={date.toString()}
              onChange={(e) => {
                if (!e.target.value) return;
                const picked = LocalDate.tryParse(e.target.value) ?? date;
                rememberHomeDay(picked, today);
                navigate({ name: "day", date: picked.toString() }, { replace: true });
              }}
            />
          </label>
          <DayArrows onStep={stepDay} />
        </div>
      </div>

      <div className={`slide-body${slide ? ` slide-${slide}` : ""}`}>
        <CenterBlock>
          {days && data && (
            <>
              <div className="section-title centered">
                <span>{note}</span>
              </div>
              <WorkoutRows
                days={days}
                date={date}
                plannedDayId={data.info.plannedDayId}
                sessions={data.info.sessions}
                lastDone={data.lastDone}
              />
            </>
          )}
        </CenterBlock>
      </div>
    </div>
  );
}
