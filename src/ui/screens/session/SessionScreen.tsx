import { useMemo, useRef, useState } from "react";
import { LocalDate } from "../../../domain/LocalDate";
import { usePageHold } from "../../components/CenterBlock";
import { BackButton } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { useSwipe } from "../../hooks/useSwipe";
import { href, navigate } from "../../router";
import { useLiveState, useServices, useSettings } from "../../ServicesContext";
import { slideNext, useSlide } from "../../slide";
import { rememberHomeDay } from "../../homePick";
import { ExerciseRow } from "./ExerciseRow";
import { useDayStep } from "../../hooks/useDayStep";
import { DayArrows } from "./DayArrows";

/**
 * A workout day on a date — the "cell" from the sheet.
 *  - ‹ › next to the date: the day before / after (whatever was logged or planned then).
 *  - Last / Next session (or swipe right / left): the previous / next time you did this workout.
 */
export function SessionScreen({ dayId, date: iso }: { dayId: string; date: string }) {
  const services = useServices();
  const { showLastSession } = useSettings();
  const today = services.calendar.today();
  const date = LocalDate.tryParse(iso) ?? today;
  const root = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [noteIds, setNoteIds] = useState<ReadonlySet<string>>(new Set());
  // App remounts this screen for every workout + date, so open rows and notes start closed.
  const slide = useSlide(`${dayId}/${iso}`);
  const stepDay = useDayStep(date, dayId);
  // The page is centered as a whole; while a row or note is open it holds its place, so the row
  // you tapped doesn't jump up as it grows (it also holds through day steps, see CenterPage).
  usePageHold(openId !== null || noteIds.size > 0);

  const daysLive = useLiveState(() => services.setup.days(), [], "days");
  const days = daysLive.value;
  const live = useLiveState(
    async () => {
      const [session, prev, next, last] = await Promise.all([
        services.sessions.open(dayId, date),
        services.sessions.previous(dayId, date),
        services.sessions.next(dayId, date),
        services.sessions.lastResultsBefore(dayId, date),
      ]);
      return { session, prev, next, last };
    },
    [dayId, date.toString()],
    "session",
  );
  const data = live.value;

  const nextDate = data?.next?.date ?? (date.isBefore(today) ? today : null);
  const prevDate = data?.prev?.date ?? null;

  /**
   * Another date of this same workout. Picking a date (or Back to today) moves Home's week
   * along; peeking at Last / Next session doesn't, so Back still lands on the week you left.
   */
  const goSession = (target: LocalDate, direction: "back" | "forward" | null, moveHome: boolean) => {
    if (direction) slideNext(direction);
    setOpenId(null);
    if (moveHome) rememberHomeDay(target, today);
    navigate({ name: "session", dayId, date: target.toString() }, { replace: true });
  };

  // The whole page area takes the swipe, not just the centered content (a short day leaves room around it).
  const swipeArea = useMemo(
    () => ({
      get current() {
        return root.current?.closest<HTMLElement>(".page") ?? root.current;
      },
    }),
    [],
  );
  useSwipe(swipeArea, {
    onSwipeRight: prevDate ? () => goSession(prevDate, "back", false) : undefined,
    onSwipeLeft: nextDate ? () => goSession(nextDate, "forward", false) : undefined,
  });

  const day = days?.find((d) => d.id === dayId);
  // Only from fresh data: a copy from before the day was added would miss it. Until then the
  // usual screen draws, without the name or rows.
  if (days && !day && daysLive.fresh) {
    return (
      <div className="empty">
        <p>This workout day doesn't exist anymore.</p>
        <a className="btn" href={href({ name: "home" })}>
          Back to this week
        </a>
      </div>
    );
  }

  const { session, last } = data ?? {};
  const exercises = day
    ? [...day.activeExercises(), ...day.allExercises().filter((e) => e.archived && session?.log(e.id)?.hasContent())]
    : [];
  const hasContent = session?.hasContent() ?? false;
  const isToday = date.equals(today);
  const toggleNote = (id: string) =>
    setNoteIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div ref={root} className="session-screen">
      <header className="session-head">
        <div className="session-top">
          <BackButton fallback={{ name: "home" }} />
          <h1 className="session-name">{day?.name ?? "\u00a0"}</h1>
        </div>
        <DayArrows onStep={stepDay}>
          <label className="date-picker num">
            {date.labelWithWeek()}
            <Icon name="down" size={14} />
            <input
              type="date"
              aria-label="Change date"
              value={date.toString()}
              onChange={(e) => e.target.value && goSession(LocalDate.tryParse(e.target.value) ?? date, null, true)}
            />
          </label>
        </DayArrows>
        <div className="session-jumps" role="group" aria-label={`Other ${day?.name ?? "workout"} sessions`}>
          <button
            type="button"
            className="jump-btn"
            disabled={!prevDate}
            aria-label={prevDate ? `Last session, ${prevDate.shortLabel()}` : "No earlier session"}
            onClick={() => prevDate && goSession(prevDate, "back", false)}
          >
            <Icon name="left" size={14} />
            Last session
          </button>
          <button
            type="button"
            className="jump-btn"
            disabled={!nextDate}
            aria-label={nextDate ? `Next session, ${nextDate.shortLabel()}` : "No later session"}
            onClick={() => nextDate && goSession(nextDate, "forward", false)}
          >
            Next session
            <Icon name="right" size={14} />
          </button>
        </div>
      </header>

      {/* Only the content slides: the header (and its arrows) stays put under your finger. */}
      <div className={`slide-body${slide ? ` slide-${slide}` : ""}`}>
        {!isToday && (
          <div className="past-banner">
            <span>{date.isBefore(today) ? `Viewing ${date.shortLabel()}` : `Planning ahead for ${date.shortLabel()}`}</span>
            <button type="button" className="link" onClick={() => goSession(today, date.isBefore(today) ? "forward" : "back", true)}>
              Back to today
            </button>
          </div>
        )}

        {/* The rows draw from the workout day at once and their numbers fill in, so the centered
            page doesn't move when the session lands. */}
        {day && (
          <>
            {exercises.length > 0 && (
              <div className="ex-table">
                <div className="ex-head" aria-hidden>
                  <span>Exercise</span>
                  <span>Weight</span>
                  <span>Reps</span>
                  <span>{showLastSession ? "Last time" : ""}</span>
                  <span>Target</span>
                </div>
                <div className="ex-list">
                  {exercises.map((ex) => (
                    <ExerciseRow
                      key={`${iso}:${ex.id}`}
                      exercise={ex}
                      log={session?.log(ex.id)}
                      last={last?.get(ex.id)}
                      showLast={showLastSession}
                      open={openId === ex.id}
                      onToggle={() => data && setOpenId((id) => (id === ex.id ? null : ex.id))}
                      noteOpen={noteIds.has(ex.id)}
                      onToggleNote={() => toggleNote(ex.id)}
                      onSave={(log) => void services.sessions.saveLog(dayId, date, log)}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* Only from fresh data: a copy from before you added exercises would show it by mistake. */}
            {!exercises.length && day && daysLive.fresh && live.fresh && (
              <div className="empty tile">
                <p>No exercises on {day.name} yet.</p>
                <a className="btn" href={href({ name: "setup", dayId })}>
                  Add exercises
                </a>
              </div>
            )}
            {/* Always there, hidden until something is logged: the centered page keeps its height, so it doesn't jump. */}
            <div className={`session-foot${hasContent ? "" : " is-hidden"}`} aria-hidden={hasContent ? undefined : true}>
              <button
                type="button"
                className="btn danger"
                disabled={!hasContent}
                onClick={() => {
                  if (confirm(`Delete ${day?.name ?? "this workout"} on ${date.shortLabel()}?`))
                    void services.sessions.delete(dayId, date);
                }}
              >
                <Icon name="trash" size={16} /> Delete this session
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
