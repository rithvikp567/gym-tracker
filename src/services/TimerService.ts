import { WorkoutTimer, type TimerKind } from "../domain/WorkoutTimer";
import { Emitter, type Unsubscribe } from "../lib/Emitter";
import { systemClock, type Clock, type KeyValueStore } from "./ports";
import type { SettingsService } from "./SettingsService";

/** The timer popup's state: which face is showing, and both timers (they run independently). */
export interface TimerState {
  /** The face the popup shows. */
  showing: TimerKind;
  rest: WorkoutTimer;
  stopwatch: WorkoutTimer;
}

const KEY = "gym-tracker.timer";
/** Rest lengths offered as one tap (seconds). */
export const REST_PRESETS: readonly number[] = [30, 60, 90, 120, 180, 300];
/** What the − / + buttons take off or add (seconds). */
export const REST_STEP = 15;

/**
 * The workout timer (D54): a rest timer and a stopwatch that keep running while you log, switch
 * screens or close the popup. The rest length is a synced setting, so it follows you between
 * devices; a running timer is this device's (saved here, so a reload or a sleeping phone keeps it).
 * When a running rest timer reaches zero, `onRing` listeners hear it once (the UI beeps).
 */
export class TimerService {
  private state: TimerState;
  private readonly emitter = new Emitter<TimerState>();
  private readonly rings = new Emitter();
  private alarm: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: KeyValueStore,
    private readonly settings: SettingsService,
    private readonly clock: Clock = systemClock,
  ) {
    this.state = this.read();
    // A length picked on another device applies here while this rest timer isn't counting.
    let known = settings.get().restSeconds;
    settings.subscribe(({ restSeconds }) => {
      if (restSeconds === known) return;
      known = restSeconds;
      if (this.state.rest.status(this.now()) === "idle") this.set({ rest: this.state.rest.reset(this.restLengthMs()) });
    });
    this.schedule();
  }

  get(): TimerState {
    return this.state;
  }

  now(): number {
    return this.clock.now().getTime();
  }

  subscribe(listener: (state: TimerState) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  /** Fires when a running rest timer reaches zero while the app is open (or as it comes back). */
  onRing(listener: () => void): Unsubscribe {
    return this.rings.subscribe(listener);
  }

  show(kind: TimerKind): void {
    if (kind !== this.state.showing) this.set({ showing: kind });
  }

  start(kind: TimerKind): void {
    this.set({ [kind]: this.state[kind].start(this.now()) });
  }

  pause(kind: TimerKind): void {
    this.set({ [kind]: this.state[kind].pause(this.now()) });
  }

  /** Stops and rewinds; the rest timer goes back to the saved length (dropping any ± tweaks). */
  reset(kind: TimerKind): void {
    this.set({ [kind]: kind === "rest" ? this.state.rest.reset(this.restLengthMs()) : this.state.stopwatch.reset() });
  }

  /** Picks the rest length: saved as the setting, and applied to the rest timer now. */
  setRestLength(seconds: number): void {
    const rest = this.state.rest.withLength(seconds * 1000);
    this.settings.update({ restSeconds: rest.lengthMs / 1000 });
    this.set({ rest });
  }

  /** ± seconds on this rest only; the saved length stays. */
  adjustRest(seconds: number): void {
    this.set({ rest: this.state.rest.adjust(seconds * 1000, this.now()) });
  }

  private restLengthMs(): number {
    return this.settings.get().restSeconds * 1000;
  }

  private set(changes: Partial<TimerState>): void {
    this.state = { ...this.state, ...changes };
    const { showing, rest, stopwatch } = this.state;
    this.store.set(KEY, JSON.stringify({ showing, rest, stopwatch }));
    this.schedule();
    this.emitter.emit(this.state);
  }

  /** Arms the ring for when the running rest timer reaches zero. */
  private schedule(): void {
    if (this.alarm !== null) clearTimeout(this.alarm);
    this.alarm = null;
    const endsAt = this.state.rest.endsAt();
    const wait = endsAt === null ? -1 : endsAt - this.now();
    // Already past zero (it ran out while the app was closed): it shows "Time's up" without a ring.
    if (wait <= 0) return;
    this.alarm = setTimeout(() => {
      this.alarm = null;
      this.rings.emit();
      this.emitter.emit(this.state); // the face reads 0:00 now
    }, wait);
  }

  private read(): TimerState {
    const fresh: TimerState = { showing: "rest", rest: WorkoutTimer.rest(this.restLengthMs()), stopwatch: WorkoutTimer.stopwatch() };
    try {
      const saved = JSON.parse(this.store.get(KEY) ?? "null") as Partial<Record<keyof TimerState, unknown>> | null;
      if (!saved || typeof saved !== "object") return fresh;
      const rest = WorkoutTimer.from(saved.rest);
      const stopwatch = WorkoutTimer.from(saved.stopwatch);
      return {
        showing: saved.showing === "stopwatch" ? "stopwatch" : "rest",
        rest: rest?.kind === "rest" ? rest : fresh.rest,
        stopwatch: stopwatch?.kind === "stopwatch" ? stopwatch : fresh.stopwatch,
      };
    } catch {
      return fresh;
    }
  }
}
