import { useMemo, useRef, useState } from "react";
import { LocalDate } from "../../../domain/LocalDate";
import { Icon } from "../../components/Icon";
import { useSwipe } from "../../hooks/useSwipe";
import { href, navigate } from "../../router";
import { useLive, useServices, useSettings } from "../../ServicesContext";
import { ExerciseRow } from "./ExerciseRow";

/** Set right before navigating so the next session slides in from the matching side. */
let pendingSlide: "back" | "forward" | null = null;

function safeDate(iso: string, fallback: LocalDate): LocalDate {
  try {
    return LocalDate.parse(iso);
  } catch {
    return fallback;
  }
}

/**
 * A workout day on a date — the "cell" from the sheet. Swipe right for the previous time you
 * did this workout, swipe left to come forward again.
 */
export function SessionScreen({ dayId, date: iso }: { dayId: string; date: string }) {
  const services = useServices();
  const { showLastSession } = useSettings();
  const today = services.calendar.today();
  const date = safeDate(iso, today);
  const root = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const data = useLive(async () => {
    const [day, session, prev, next, last] = await Promise.all([
      services.setup.days().then((days) => days.find((d) => d.id === dayId)),
      services.sessions.open(dayId, date),
      services.sessions.previous(dayId, date),
      services.sessions.next(dayId, date),
      services.sessions.lastResultsBefore(dayId, date),
    ]);
    return { day, session, prev, next, last };
  }, [dayId, date.toString()]);

  const slide = useMemo(() => {
    const s = pendingSlide;
    pendingSlide = null;
    return s;
  }, [iso]);

  const nextDate = data?.next?.date ?? (date.isBefore(today) ? today : null);
  const prevDate = data?.prev?.date ?? null;

  const go = (target: LocalDate, direction: "back" | "forward") => {
    pendingSlide = direction;
    setOpenId(null);
    navigate({ name: "session", dayId, date: target.toString() }, { replace: true });
  };

  useSwipe(root, {
    onSwipeRight: prevDate ? () => go(prevDate, "back") : undefined,
    onSwipeLeft: nextDate ? () => go(nextDate, "forward") : undefined,
  });

  if (data && !data.day) {
    return (
      <div className="empty">
        <p>This workout day doesn't exist anymore.</p>
        <a className="btn" href={href({ name: "home" })}>
          Back to this week
        </a>
      </div>
    );
  }

  const { day, session, last } = data ?? {};
  const exercises = day
    ? [...day.activeExercises(), ...day.allExercises().filter((e) => e.archived && session?.log(e.id)?.hasContent())]
    : [];
  const isToday = date.equals(today);

  return (
    <div ref={root}>
    <div className={`session-screen${slide ? ` slide-${slide}` : ""}`} key={iso}>
      <div className="session-head">
        <a className="icon-btn" href={href({ name: "home" })} aria-label="Back to this week">
          <Icon name="left" />
        </a>
        <div className="session-title">
          <h1>{day?.name ?? " "}</h1>
        </div>
        <div className="inline">
          <button type="button" className="icon-btn" aria-label="Previous time" disabled={!prevDate} onClick={() => prevDate && go(prevDate, "back")}>
            <Icon name="left" size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Next time" disabled={!nextDate} onClick={() => nextDate && go(nextDate, "forward")}>
            <Icon name="right" size={20} />
          </button>
        </div>
      </div>
      <div className="swipe-hint">
        <label className="date-picker num">
          {date.label()} · Week {date.isoWeek()}
          <Icon name="down" size={14} />
          <input
            type="date"
            aria-label="Change date"
            value={date.toString()}
            onChange={(e) => e.target.value && navigate({ name: "session", dayId, date: e.target.value }, { replace: true })}
          />
        </label>
        <span className="hint-text">{prevDate ? "‹ swipe for last time" : ""}</span>
      </div>

      {!isToday && (
        <div className="past-banner">
          <span>{date.isBefore(today) ? `Viewing ${date.shortLabel()}` : `Planning ahead for ${date.shortLabel()}`}</span>
          <a className="link" onClick={() => (pendingSlide = "forward")} href={href({ name: "session", dayId, date: today.toString() })}>
            Back to today
          </a>
        </div>
      )}

      {data && (
        <>
          <div className="ex-head" aria-hidden>
            <span>Exercise</span>
            <span>Weight</span>
            <span>Reps</span>
            <span>{showLastSession ? "Last time" : ""}</span>
            <span>Target</span>
          </div>
          <div className="list">
            {exercises.map((ex) => (
              <ExerciseRow
                key={`${iso}:${ex.id}`}
                exercise={ex}
                log={session?.log(ex.id)}
                last={last?.get(ex.id)}
                showLast={showLastSession}
                open={openId === ex.id}
                onToggle={() => setOpenId((id) => (id === ex.id ? null : ex.id))}
                onSave={(log) => void services.sessions.saveLog(dayId, date, log)}
              />
            ))}
          </div>
          {!exercises.length && (
            <div className="empty">
              <p>No exercises on {day?.name} yet.</p>
              <a className="btn" href={href({ name: "setup" })}>
                Add exercises
              </a>
            </div>
          )}
          {session?.hasContent() && (
            <div style={{ marginTop: 28, textAlign: "center" }}>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  if (confirm(`Delete ${day?.name} on ${date.shortLabel()}?`)) void services.sessions.delete(dayId, date);
                }}
              >
                <Icon name="trash" size={16} /> Delete this session
              </button>
            </div>
          )}
        </>
      )}
    </div>
    </div>
  );
}
