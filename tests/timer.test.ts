import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock, WorkoutTimer } from "../src/domain/WorkoutTimer";
import type { KeyValueStore } from "../src/services/ports";
import { SettingsService } from "../src/services/SettingsService";
import { TimerService } from "../src/services/TimerService";

const S = 1000;

describe("WorkoutTimer", () => {
  it("counts a rest down from its length, pauses, resumes, and is done at zero", () => {
    let t = WorkoutTimer.rest(90 * S);
    expect([t.status(0), t.shown(0)]).toEqual(["idle", 90 * S]);
    t = t.start(1_000);
    expect([t.status(31_000), t.remaining(31_000), t.endsAt()]).toEqual(["running", 60 * S, 91_000]);
    t = t.pause(31_000);
    expect([t.status(500_000), t.remaining(500_000)]).toEqual(["paused", 60 * S]); // paused time doesn't count
    t = t.start(600_000);
    expect(t.endsAt()).toBe(660_000);
    expect([t.status(659_999), t.status(660_000), t.remaining(700_000)]).toEqual(["running", "done", 0]);
    // Start again from done: the full length over.
    expect(t.start(700_000).remaining(700_000)).toBe(90 * S);
  });

  it("counts a stopwatch up, through pauses, and is never done", () => {
    let t = WorkoutTimer.stopwatch().start(0);
    t = t.pause(65 * S).start(100 * S);
    expect([t.elapsed(110 * S), t.status(10_000 * S), t.endsAt()]).toEqual([75 * S, "running", null]);
    expect(t.reset().status(0)).toBe("idle");
  });

  it("adjusts a rest by ±15 s; taking off more than is left ends it, and an unstarted one stays at least 5 s", () => {
    const running = WorkoutTimer.rest(60 * S).start(0);
    expect(running.adjust(15 * S, 10 * S).remaining(10 * S)).toBe(65 * S);
    expect(running.adjust(-15 * S, 10 * S).remaining(10 * S)).toBe(35 * S);
    expect(running.adjust(-120 * S, 10 * S).status(10 * S)).toBe("done");
    expect(WorkoutTimer.rest(10 * S).adjust(-15 * S, 0).lengthMs).toBe(5 * S);
    // A new length keeps the time already counted.
    expect(running.withLength(120 * S).remaining(40 * S)).toBe(80 * S);
    expect(WorkoutTimer.stopwatch().adjust(15 * S, 0).lengthMs).toBe(0);
  });

  it("keeps lengths between 5 s and an hour, and reads back only what it wrote", () => {
    expect(WorkoutTimer.rest(1).lengthMs).toBe(5 * S);
    expect(WorkoutTimer.rest(5 * 3600 * S).lengthMs).toBe(3600 * S);
    const t = WorkoutTimer.rest(90 * S).start(123);
    expect(WorkoutTimer.from(JSON.parse(JSON.stringify(t)))).toEqual(t);
    for (const junk of [null, 3, {}, { kind: "rest", countedMs: -1, startedAt: null, lengthMs: 1 }, { kind: "lap", countedMs: 0, startedAt: null }, { kind: "rest", countedMs: 0, startedAt: "x", lengthMs: 1 }]) {
      expect(WorkoutTimer.from(junk)).toBeNull();
    }
  });

  it("formats rest rounded up and the stopwatch rounded down, with hours past an hour", () => {
    expect([formatClock(90_000, "up"), formatClock(89_001, "up"), formatClock(1, "up"), formatClock(0, "up")]).toEqual(["1:30", "1:30", "0:01", "0:00"]);
    expect([formatClock(59_999, "down"), formatClock(3_725_000, "down")]).toEqual(["0:59", "1:02:05"]);
  });
});

describe("TimerService", () => {
  let now = 0;
  const clock = { now: () => new Date(now) };
  const memory = (): KeyValueStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  it("starts the rest timer at the saved length and rings once when it reaches zero", () => {
    const store = memory();
    const settings = new SettingsService(store, clock);
    const timer = new TimerService(store, settings, clock);
    expect(timer.get().rest.lengthMs).toBe(90 * S); // the default
    let rings = 0;
    timer.onRing(() => rings++);
    timer.start("rest");
    advance(89 * S);
    expect(rings).toBe(0);
    advance(1 * S);
    expect([rings, timer.get().rest.status(now)]).toEqual([1, "done"]);
    advance(60 * S);
    expect(rings).toBe(1);
  });

  it("saves a picked rest length as the synced setting; ±15 s and Reset don't change it", () => {
    const store = memory();
    const settings = new SettingsService(store, clock);
    const timer = new TimerService(store, settings, clock);
    timer.setRestLength(120);
    expect(settings.get().restSeconds).toBe(120);
    timer.adjustRest(15);
    expect([timer.get().rest.lengthMs, settings.get().restSeconds]).toEqual([135 * S, 120]);
    timer.reset("rest");
    expect(timer.get().rest.lengthMs).toBe(120 * S);
    // Picked on another device: applies while the rest timer isn't counting, not in the middle of one.
    settings.applyRemote({ values: { restSeconds: 60 }, updatedAt: new Date(now + 1).toISOString(), stamps: { restSeconds: new Date(now + 1).toISOString() } });
    expect(timer.get().rest.lengthMs).toBe(60 * S);
    timer.start("rest");
    settings.applyRemote({ values: { restSeconds: 180 }, updatedAt: new Date(now + 2).toISOString(), stamps: { restSeconds: new Date(now + 2).toISOString() } });
    expect(timer.get().rest.lengthMs).toBe(60 * S);
  });

  it("keeps both timers running on this device through a reload, and rings only if the app is open when time's up", () => {
    const store = memory();
    const settings = new SettingsService(store, clock);
    const first = new TimerService(store, settings, clock);
    first.start("stopwatch");
    first.start("rest");
    first.show("stopwatch");
    advance(30 * S);

    const reloaded = new TimerService(store, settings, clock);
    let rings = 0;
    reloaded.onRing(() => rings++);
    expect(reloaded.get().showing).toBe("stopwatch");
    expect(reloaded.get().stopwatch.elapsed(now)).toBe(30 * S);
    expect(reloaded.get().rest.remaining(now)).toBe(60 * S);
    advance(60 * S);
    expect(rings).toBeGreaterThanOrEqual(1); // the reloaded one rings (the first instance's timeout may too)

    // Ran out while the app was closed: shows time's up, no ring on opening.
    const later = new TimerService(store, settings, clock);
    let lateRings = 0;
    later.onRing(() => lateRings++);
    advance(10 * S);
    expect([later.get().rest.status(now), lateRings]).toEqual(["done", 0]);
  });

  it("starts fresh from a damaged saved copy", () => {
    const store = memory();
    store.set("gym-tracker.timer", "{not json");
    const settings = new SettingsService(store, clock);
    expect(new TimerService(store, settings, clock).get().rest.status(now)).toBe("idle");
    store.set("gym-tracker.timer", JSON.stringify({ showing: "x", rest: { kind: "stopwatch", countedMs: 0, startedAt: null }, stopwatch: 4 }));
    const timer = new TimerService(store, settings, clock);
    expect([timer.get().showing, timer.get().rest.kind, timer.get().stopwatch.kind]).toEqual(["rest", "rest", "stopwatch"]);
  });
});
