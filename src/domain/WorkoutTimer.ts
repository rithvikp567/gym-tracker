/** A rest timer counts down from its length; a stopwatch counts up. */
export type TimerKind = "rest" | "stopwatch";

/** What a timer is doing at a moment. `done` is a rest timer that reached zero. */
export type TimerStatus = "idle" | "running" | "paused" | "done";

export interface WorkoutTimerData {
  kind: TimerKind;
  /** A rest timer's length (ms). Ignored by a stopwatch. */
  lengthMs: number;
  /** When it was last started (epoch ms), or null while stopped. */
  startedAt: number | null;
  /** Time counted before the last start (ms). */
  countedMs: number;
}

/** The shortest and longest rest a timer can be set to. */
export const MIN_REST_MS = 5_000;
export const MAX_REST_MS = 60 * 60_000;

/**
 * The workout timer (D54): a value, like every domain object, so pausing or adjusting returns a
 * new one. It stores when it started rather than ticking, so it's right after the phone sleeps,
 * the app goes to the background or the page reloads. Everything that needs "now" takes it.
 */
export class WorkoutTimer {
  private constructor(
    readonly kind: TimerKind,
    readonly lengthMs: number,
    readonly startedAt: number | null,
    readonly countedMs: number,
  ) {}

  static rest(lengthMs: number): WorkoutTimer {
    return new WorkoutTimer("rest", clampRest(lengthMs), null, 0);
  }

  static stopwatch(): WorkoutTimer {
    return new WorkoutTimer("stopwatch", 0, null, 0);
  }

  /** A saved timer, or null when it can't be read. */
  static from(data: unknown): WorkoutTimer | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Partial<Record<keyof WorkoutTimerData, unknown>>;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (d.kind !== "rest" && d.kind !== "stopwatch") return null;
    if (!finite(d.countedMs) || d.countedMs < 0) return null;
    if (d.startedAt !== null && !finite(d.startedAt)) return null;
    const length = d.kind === "rest" ? (finite(d.lengthMs) ? clampRest(d.lengthMs) : null) : 0;
    if (length === null) return null;
    return new WorkoutTimer(d.kind, length, d.startedAt, d.countedMs);
  }

  /** Time counted so far (ms). A clock turned back never makes it go below what was counted. */
  elapsed(now: number): number {
    return this.countedMs + (this.startedAt === null ? 0 : Math.max(0, now - this.startedAt));
  }

  /** A rest timer's time left (ms), never below zero. */
  remaining(now: number): number {
    return Math.max(0, this.lengthMs - this.elapsed(now));
  }

  status(now: number): TimerStatus {
    if (this.kind === "rest" && (this.startedAt !== null || this.countedMs > 0) && this.remaining(now) === 0) return "done";
    if (this.startedAt !== null) return "running";
    return this.countedMs > 0 ? "paused" : "idle";
  }

  /** When a running rest timer reaches zero (epoch ms), else null. */
  endsAt(): number | null {
    if (this.kind !== "rest" || this.startedAt === null) return null;
    return this.startedAt + this.lengthMs - this.countedMs;
  }

  /** What the face shows (ms): time left for rest, time counted for a stopwatch. */
  shown(now: number): number {
    return this.kind === "rest" ? this.remaining(now) : this.elapsed(now);
  }

  /** Starts or resumes; a rest timer that reached zero starts over from its full length. */
  start(now: number): WorkoutTimer {
    if (this.status(now) === "done") return new WorkoutTimer(this.kind, this.lengthMs, now, 0);
    if (this.startedAt !== null) return this;
    return new WorkoutTimer(this.kind, this.lengthMs, now, this.countedMs);
  }

  pause(now: number): WorkoutTimer {
    if (this.startedAt === null) return this;
    const counted = this.kind === "rest" ? Math.min(this.elapsed(now), this.lengthMs) : this.elapsed(now);
    return new WorkoutTimer(this.kind, this.lengthMs, null, counted);
  }

  /** Back to the start, stopped; a rest timer takes `lengthMs` if given. */
  reset(lengthMs: number = this.lengthMs): WorkoutTimer {
    return this.kind === "rest" ? WorkoutTimer.rest(lengthMs) : WorkoutTimer.stopwatch();
  }

  /**
   * A new length for a rest timer. Counting keeps going: a rest that has run 40 s of 1:30 and
   * becomes 2:00 has 1:20 left. Lengths are kept between 5 s and an hour.
   */
  withLength(lengthMs: number): WorkoutTimer {
    if (this.kind !== "rest") return this;
    return new WorkoutTimer(this.kind, clampRest(lengthMs), this.startedAt, this.countedMs);
  }

  /**
   * ± some time on a rest timer (the ±15 s buttons). Taking off more than is left ends it; a
   * timer that hasn't started stays at least 5 s long.
   */
  adjust(deltaMs: number, now: number): WorkoutTimer {
    if (this.kind !== "rest") return this;
    const floor = this.status(now) === "idle" ? MIN_REST_MS : this.elapsed(now);
    const length = Math.min(MAX_REST_MS, Math.max(floor, this.lengthMs + deltaMs));
    return new WorkoutTimer(this.kind, length, this.startedAt, this.countedMs);
  }

  toJSON(): WorkoutTimerData {
    return { kind: this.kind, lengthMs: this.lengthMs, startedAt: this.startedAt, countedMs: this.countedMs };
  }
}

function clampRest(ms: number): number {
  return Math.min(MAX_REST_MS, Math.max(MIN_REST_MS, Math.round(ms / 1000) * 1000));
}

/**
 * "1:30", or "1:02:05" past an hour. A rest timer rounds up, so it reads 1:30 the moment it
 * starts and reaches 0:00 only when time's up; a stopwatch rounds down.
 */
export function formatClock(ms: number, round: "up" | "down"): string {
  const total = Math.max(0, round === "up" ? Math.ceil(ms / 1000 - 1e-9) : Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
