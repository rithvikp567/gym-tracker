import { useCallback, useState } from "react";
import { formatClock, type TimerKind, type TimerStatus } from "../../domain/WorkoutTimer";
import { REST_PRESETS, REST_STEP } from "../../services/TimerService";
import { Segmented, Sheet } from "../components/controls";
import { Icon } from "../components/Icon";
import { useServices } from "../ServicesContext";
import { primeAlarm } from "./alarm";
import { useTimer } from "./useTimer";

const KINDS: readonly { key: TimerKind; label: string }[] = [
  { key: "rest", label: "Rest timer" },
  { key: "stopwatch", label: "Stopwatch" },
];

const STATUS_LINE: Record<TimerKind, Record<TimerStatus, string>> = {
  rest: { idle: "Ready", running: "Resting", paused: "Paused", done: "Time's up" },
  stopwatch: { idle: "Ready", running: "Running", paused: "Paused", done: "Running" },
};

/**
 * The clock beside Next session (D54). While a timer counts it shows the time: the rest timer's
 * time left first (it's the one you're waiting on), else the stopwatch's.
 */
export function TimerButton() {
  const { state, now } = useTimer();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const rest = state.rest.status(now);
  const time =
    rest === "running" || rest === "done"
      ? formatClock(state.rest.remaining(now), "up")
      : state.stopwatch.status(now) === "running"
        ? formatClock(state.stopwatch.elapsed(now), "down")
        : null;
  return (
    <>
      <button
        type="button"
        className={`jump-btn timer-btn${rest === "done" ? " is-done" : ""}`}
        aria-label={time ? `Timer, ${time}` : "Timer"}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="clock" size={16} />
        {time && <span className="num">{time}</span>}
      </button>
      {open && <TimerSheet onClose={close} />}
    </>
  );
}

/** The popup: rest timer or stopwatch, each with Start / Pause and Reset; both keep running when it closes. */
export function TimerSheet({ onClose }: { onClose: () => void }) {
  const { timer } = useServices();
  const { state, now } = useTimer();
  const kind = state.showing;
  const current = state[kind];
  const status = current.status(now);
  const isRest = kind === "rest";

  const toggle = () => {
    if (status === "running") return timer.pause(kind);
    primeAlarm(); // this tap is what lets the ring play sound later
    timer.start(kind);
  };

  return (
    <Sheet title="Timer" onClose={onClose}>
      <div className="timer">
        <Segmented label="Timer type" options={KINDS} value={kind} onChange={(k) => timer.show(k)} />
        <div className={`timer-face${isRest ? "" : " no-steps"}`}>
          {isRest && (
            <button type="button" className="timer-step num" aria-label={`${REST_STEP} seconds less`} onClick={() => timer.adjustRest(-REST_STEP)}>
              −{REST_STEP}
            </button>
          )}
          <div className={`timer-digits num${status === "done" ? " is-done" : ""}`} role="timer">
            {formatClock(current.shown(now), isRest ? "up" : "down")}
          </div>
          {isRest && (
            <button type="button" className="timer-step num" aria-label={`${REST_STEP} seconds more`} onClick={() => timer.adjustRest(REST_STEP)}>
              +{REST_STEP}
            </button>
          )}
        </div>
        <p className="timer-status" aria-live="polite">
          {STATUS_LINE[kind][status]}
        </p>
        {isRest && (
          <div className="timer-presets" role="group" aria-label="Rest length">
            {REST_PRESETS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                className="chip-btn num"
                aria-pressed={state.rest.lengthMs === seconds * 1000}
                onClick={() => timer.setRestLength(seconds)}
              >
                {formatClock(seconds * 1000, "down")}
              </button>
            ))}
          </div>
        )}
        <div className="timer-actions">
          <button type="button" className="btn primary" onClick={toggle}>
            {status === "running" ? "Pause" : status === "paused" ? "Resume" : status === "done" ? "Again" : "Start"}
          </button>
          <button type="button" className="btn" disabled={status === "idle"} onClick={() => timer.reset(kind)}>
            Reset
          </button>
        </div>
        <p className="timer-hint">Keeps running while you log or close this.</p>
      </div>
    </Sheet>
  );
}
