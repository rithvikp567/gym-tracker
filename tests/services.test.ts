import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { EPOCH } from "../src/domain/ids";
import { LocalDate } from "../src/domain/LocalDate";
import { Session } from "../src/domain/Session";
import { SetEntry } from "../src/domain/SetEntry";
import { Split } from "../src/domain/Split";
import { WorkoutDay } from "../src/domain/WorkoutDay";
import { CalendarService } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import type { ImportPlan } from "../src/services/ImportPlan";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { SettingsService } from "../src/services/SettingsService";
import { SetupService } from "../src/services/SetupService";
import type { Clock, KeyValueStore } from "../src/services/ports";

const clock: Clock = { now: () => new Date(2026, 10, 20, 12) }; // Fri Nov 20 2026, local time
const d = (iso: string) => LocalDate.parse(iso);

let store: MemoryRecordStore;
let repos: StoreRepositories;
let setup: SetupService;
let sessions: SessionService;

async function upperDay() {
  let day = await setup.createDay("Upper 1");
  day = (await setup.updateDay(day.id, (x) => x.addExercise("Pulldown").addExercise("Triceps")))!;
  const [pull, tri] = day.activeExercises();
  return { day, pull: pull!, tri: tri! };
}

const sets = (weight: number, ...reps: number[]) => reps.map((r) => new SetEntry(weight, r));

beforeEach(() => {
  store = new MemoryRecordStore();
  repos = new StoreRepositories(store, clock);
  setup = new SetupService(repos);
  sessions = new SessionService(repos);
});

describe("SessionService", () => {
  it("navigates a workout day's history (swipe back and forward)", async () => {
    const { day, pull } = await upperDay();
    for (const [date, w] of [["2026-11-02", 150], ["2026-11-09", 155], ["2026-11-16", 160]] as const) {
      await sessions.saveLog(day.id, d(date), ExerciseLog.empty(pull.id).withSets(sets(w, 8, 8)));
    }
    expect((await sessions.previous(day.id, d("2026-11-20")))?.isoDate).toBe("2026-11-16");
    expect((await sessions.previous(day.id, d("2026-11-16")))?.isoDate).toBe("2026-11-09");
    expect((await sessions.next(day.id, d("2026-11-02")))?.isoDate).toBe("2026-11-09");
    expect(await sessions.next(day.id, d("2026-11-16"))).toBeUndefined();

    const last = await sessions.lastResultsBefore(day.id, d("2026-11-20"));
    expect(last.get(pull.id)?.log.summary()).toBe("160 · 8/8");
  });

  it("knows when each workout day was last done", async () => {
    const { day, pull } = await upperDay();
    const lower = await setup.createDay("Lower");
    await sessions.saveLog(day.id, d("2026-11-02"), ExerciseLog.empty(pull.id).withSets(sets(150, 8)));
    await sessions.saveLog(day.id, d("2026-11-16"), ExerciseLog.empty(pull.id).withSets(sets(160, 8)));
    await sessions.saveLog(day.id, d("2026-11-23"), ExerciseLog.empty(pull.id).withSets(sets(165, 8))); // future
    await sessions.saveLog(day.id, d("2026-11-18"), ExerciseLog.empty(pull.id).withNote("only a note")); // not a workout
    const last = await sessions.lastWorkoutDates(d("2026-11-20"));
    expect(last.get(day.id)?.toString()).toBe("2026-11-16");
    expect(last.has(lower.id)).toBe(false);
  });

  it("queues every local save for sync", async () => {
    const { day, pull } = await upperDay();
    await sessions.saveLog(day.id, d("2026-11-20"), ExerciseLog.empty(pull.id).withSets(sets(100, 5)));
    const outbox = await store.outbox();
    expect(outbox.map((e) => e.table).sort()).toEqual(["sessions", "workout_days"]);
  });
});

describe("CalendarService", () => {
  it("gives green for workouts and red for missed planned days", async () => {
    const { day, pull } = await upperDay();
    await setup.setPlanned(0, day.id); // Mondays
    await sessions.saveLog(day.id, d("2026-11-09"), ExerciseLog.empty(pull.id).withSets(sets(100, 5)));
    const calendar = new CalendarService(repos, clock);
    const days = await calendar.range(d("2026-11-02"), d("2026-11-23"));
    const status = (iso: string) => days.find((x) => x.date.toString() === iso)?.status;
    expect(status("2026-11-02")).toBe("rest"); // before the first workout: not "missed"
    expect(status("2026-11-09")).toBe("done");
    expect(status("2026-11-16")).toBe("missed");
    expect(status("2026-11-23")).toBe("planned");
  });
});

describe("CalendarService day arrows", () => {
  const date = d("2026-11-17"); // a Tuesday
  const days = ["u1", "lower", "u2", "abs"].map((name, i) => WorkoutDay.from({ id: name, name, order: i, exercises: [], updatedAt: EPOCH, deleted: false }));
  const split = Split.empty().withWeekday(0, "u1").withWeekday(1, "lower").withWeekday(3, "u2");
  const logged = (dayId: string, on = date) =>
    Session.start(dayId, on).withLog(ExerciseLog.empty("e").withSets([new SetEntry(100, 5)]));
  const target = (sessionsOnDate: Session[], current: string | null, on = date) => CalendarService.target(on, sessionsOnDate, split, days, current);

  it("opens the planned workout when nothing is logged, and the pick list on a rest day", () => {
    expect(target([], "u1")).toEqual({ kind: "workout", dayId: "lower" });
    expect(target([], "u1", d("2026-11-18"))).toEqual({ kind: "pick" }); // Wednesday: rest
  });

  it("prefers what was logged, staying on the current workout when it was done that day", () => {
    expect(target([logged("abs")], "u1")).toEqual({ kind: "workout", dayId: "abs" });
    expect(target([logged("abs"), logged("lower")], "abs")).toEqual({ kind: "workout", dayId: "abs" });
    expect(target([logged("abs"), logged("lower")], "u1")).toEqual({ kind: "workout", dayId: "lower" }); // the planned one
    expect(target([logged("abs"), logged("u2")], "u1")).toEqual({ kind: "pick" }); // two, neither planned
  });

  it("ignores empty sessions and deleted workout days", () => {
    expect(target([Session.start("abs", date)], null)).toEqual({ kind: "workout", dayId: "lower" });
    expect(target([logged("gone")], null, d("2026-11-18"))).toEqual({ kind: "pick" });
  });

  it("looks up the day from storage", async () => {
    const { day, pull } = await upperDay();
    await setup.setPlanned(0, day.id);
    const calendar = new CalendarService(repos, clock);
    expect(await calendar.dayTarget(d("2026-11-16"), null)).toEqual({ kind: "workout", dayId: day.id });
    await sessions.saveLog(day.id, d("2026-11-18"), ExerciseLog.empty(pull.id).withSets(sets(100, 5)));
    expect(await calendar.dayTarget(d("2026-11-18"), null)).toEqual({ kind: "workout", dayId: day.id });
    expect(await calendar.dayTarget(d("2026-11-19"), day.id)).toEqual({ kind: "pick" });
  });
});

describe("SetupService exercise management", () => {
  async function lowerWithPress() {
    let day = await setup.createDay("Lower");
    day = (await setup.updateDay(day.id, (x) => x.addExercise("Leg Press (Plates)").addExercise("Legpress").addExercise("Squat")))!;
    const [press, oldPress, squat] = day.allExercises();
    return { day, press: press!, oldPress: oldPress!, squat: squat! };
  }

  it("merges one exercise into another, combining logs from the same day", async () => {
    const { day, press, oldPress } = await lowerWithPress();
    await sessions.saveLog(day.id, d("2026-10-06"), ExerciseLog.empty(oldPress.id).withSets(sets(300, 10)));
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(oldPress.id).withSets(sets(310, 8)));
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(press.id).withSets(sets(2.5, 10)));
    expect((await setup.usage(day.id)).get(oldPress.id)).toBe(2);

    await setup.mergeExercise(day.id, oldPress.id, press.id);
    const saved = (await setup.days())[0]!;
    expect(saved.allExercises().map((e) => e.name)).toEqual(["Leg Press (Plates)", "Squat"]);
    const history = await sessions.history(day.id);
    expect(history.map((s) => s.logs.map((l) => l.exerciseId))).toEqual([[press.id], [press.id]]);
    expect(history[1]!.log(press.id)?.repsLabel()).toBe("10/8");
    expect((await setup.usage(day.id)).get(press.id)).toBe(2);
  });

  it("deletes an exercise with its history, and sessions left empty", async () => {
    const { day, oldPress, squat } = await lowerWithPress();
    await sessions.saveLog(day.id, d("2026-10-06"), ExerciseLog.empty(oldPress.id).withSets(sets(300, 10)));
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(oldPress.id).withSets(sets(310, 8)));
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(squat.id).withSets(sets(225, 5)));

    await setup.deleteExercise(day.id, oldPress.id);
    expect((await setup.days())[0]!.exercise(oldPress.id)).toBeUndefined();
    const history = await sessions.history(day.id);
    expect(history.map((s) => s.isoDate)).toEqual(["2026-10-13"]);
    expect(history[0]!.logs.map((l) => l.exerciseId)).toEqual([squat.id]);
  });

  it("keeps a merge when the sheet is imported again", async () => {
    const imports = new ImportService(repos);
    const plan: ImportPlan = {
      source: "test.xlsx",
      split: [null, "Lower", null, null, null, null, null],
      warnings: [],
      skippedCopies: 0,
      days: [
        {
          name: "Lower",
          exercises: [
            { key: "legpressplates", name: "Leg Press (Plates)", kind: "strength", targetSets: null, targetText: null, active: true },
            { key: "legpress", name: "Legpress", kind: "strength", targetSets: null, targetText: null, active: false },
          ],
          sessions: [{ date: "2026-03-03", label: "Mar · week 1", logs: [{ key: "legpress", sets: [{ weight: 300, reps: 10 }], done: null, note: "" }] }],
        },
      ],
    };
    await imports.apply(plan);
    const day = (await setup.days())[0]!;
    const [press, oldPress] = day.allExercises();
    await setup.mergeExercise(day.id, oldPress!.id, press!.id);

    const again = await imports.apply(plan);
    expect(again.exercisesCreated).toBe(0);
    const after = (await setup.days())[0]!;
    expect(after.allExercises().map((e) => e.name)).toEqual(["Leg Press (Plates)"]);
    expect((await sessions.history(day.id))[0]!.log(press!.id)?.summary()).toBe("300 · 10");
  });
});

describe("ProgressService", () => {
  it("returns one line per exercise within the range", async () => {
    const { day, pull, tri } = await upperDay();
    await sessions.saveLog(day.id, d("2026-01-05"), ExerciseLog.empty(pull.id).withSets(sets(140, 8)));
    await sessions.saveLog(day.id, d("2026-11-02"), ExerciseLog.empty(pull.id).withSets(sets(150, 8)));
    await sessions.saveLog(day.id, d("2026-11-16"), ExerciseLog.empty(pull.id).withSets([new SetEntry(150, 8), new SetEntry(160, 6)]));
    await sessions.saveLog(day.id, d("2026-11-16"), ExerciseLog.empty(tri.id).withSets(sets(50, 10)));
    const progress = new ProgressService(repos, clock);

    const month = await progress.lines(day.id, "1M");
    expect(month.lines.map((l) => l.exercise.name)).toEqual(["Pulldown", "Triceps"]);
    expect(month.lines[0]!.points.map((p) => p.weight)).toEqual([150, 160]);

    const all = await progress.lines(day.id, "ALL");
    expect(all.lines[0]!.points).toHaveLength(3);
  });

  it("charts plates as pounds and labels them as plates", async () => {
    let day = await setup.createDay("Lower");
    day = (await setup.updateDay(day.id, (x) => x.addExercise("Leg press")))!;
    const press = day.activeExercises()[0]!;
    await setup.updateDay(day.id, (x) => x.withExercise(press.with({ unit: "plates" })));
    await sessions.saveLog(day.id, d("2026-11-17"), ExerciseLog.empty(press.id).withSets([new SetEntry(2.5, 10), new SetEntry(3, 8)]));
    const [line] = (await new ProgressService(repos, clock).lines(day.id, "1M")).lines;
    expect(line!.points[0]).toMatchObject({ weight: 270, label: "3 pl", summary: "2.5/3 pl (270 lb) · 10/8" });
  });
});

describe("ImportService", () => {
  const plan: ImportPlan = {
    source: "test.xlsx",
    split: ["Upper 1", null, null, null, null, null, null],
    warnings: [],
    skippedCopies: 0,
    days: [
      {
        name: "Upper 1",
        exercises: [
          { key: "pulldown", name: "Pulldown", kind: "strength", targetSets: 2, targetText: null, active: true },
          { key: "singletricep", name: "Single tricep", kind: "strength", targetSets: null, targetText: null, active: false },
        ],
        sessions: [
          { date: "2026-02-02", label: "Feb · week 1", logs: [{ key: "pulldown", sets: [{ weight: 160, reps: 10 }], done: null, note: "" }] },
        ],
      },
    ],
  };

  it("creates days, exercises, sessions, and the split, and is safe to re-run", async () => {
    const imports = new ImportService(repos);
    const first = await imports.apply(plan);
    expect(first).toEqual({ daysCreated: 1, exercisesCreated: 2, sessionsWritten: 1 });
    const second = await imports.apply(plan);
    expect(second.daysCreated).toBe(0);
    expect(second.exercisesCreated).toBe(0);

    const days = await setup.days();
    expect(days).toHaveLength(1);
    expect(days[0]!.activeExercises().map((e) => e.name)).toEqual(["Pulldown"]);
    expect(await repos.sessions.all()).toHaveLength(1);
    expect((await setup.split()).plannedOn(0)).toBe(days[0]!.id);
  });
});

describe("SettingsService", () => {
  const memoryStore = (initial?: object): KeyValueStore => {
    const map = new Map<string, string>(initial ? [["gym-tracker.settings", JSON.stringify(initial)]] : []);
    return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
  };

  it("stamps changes for sync and tells sync about them", () => {
    const settings = new SettingsService(memoryStore(), clock);
    expect(settings.snapshot().updatedAt).toBe(EPOCH); // untouched defaults
    let changes = 0;
    settings.onLocalChange(() => changes++);
    settings.update({ theme: "graphite" });
    expect(changes).toBe(1);
    const now = clock.now().toISOString();
    expect(settings.snapshot()).toEqual({
      values: { theme: "graphite", showLastSession: true },
      updatedAt: now,
      stamps: { theme: now, showLastSession: EPOCH }, // only the setting that changed
    });
  });

  it("never stamps a change earlier than the stamp it replaces", () => {
    const settings = new SettingsService(memoryStore(), clock);
    const ahead = new Date(clock.now().getTime() + 3_600_000); // copied from a device whose clock is an hour fast
    settings.applyRemote({ values: { theme: "graphite" }, updatedAt: ahead.toISOString() });
    settings.update({ theme: "oled" });
    expect(settings.snapshot().stamps).toEqual({ theme: new Date(ahead.getTime() + 1).toISOString(), showLastSession: EPOCH });
  });

  it("dates choices saved before sync just after the epoch, so any real change wins", () => {
    const settings = new SettingsService(memoryStore({ theme: "graphite" }), clock);
    expect(settings.get().theme).toBe("graphite");
    expect(settings.snapshot().updatedAt).toBe("1970-01-01T00:00:00.001Z");
  });

  it("dates settings saved before per-setting stamps by their copy's time, and survives damaged times", () => {
    const older = new SettingsService(memoryStore({ theme: "graphite", showLastSession: false, updatedAt: "2026-11-21T10:00:00Z" }), clock);
    expect(older.snapshot().stamps).toEqual({ theme: "2026-11-21T10:00:00.000Z", showLastSession: "2026-11-21T10:00:00.000Z" });
    // A setting missing from the saved copy (added in a later version) was never chosen here.
    const missing = new SettingsService(memoryStore({ theme: "graphite", updatedAt: "2026-11-21T10:00:00.000Z" }), clock);
    expect(missing.snapshot().stamps).toEqual({ theme: "2026-11-21T10:00:00.000Z", showLastSession: EPOCH });
    const damaged = new SettingsService(memoryStore({ theme: "graphite", updatedAt: "soon", stamps: { theme: 42, showLastSession: "later" } }), clock);
    expect(damaged.snapshot().updatedAt).toBe("1970-01-01T00:00:00.001Z");
    damaged.update({ showLastSession: false });
    expect(damaged.snapshot().stamps).toEqual({ theme: "1970-01-01T00:00:00.001Z", showLastSession: clock.now().toISOString() });
  });

  it("applies another device's copy without echoing it back, and ignores bad values", () => {
    const store = memoryStore();
    const settings = new SettingsService(store, clock);
    let changes = 0;
    let seen = "";
    settings.onLocalChange(() => changes++);
    settings.subscribe((s) => (seen = s.theme));
    settings.applyRemote({ values: { theme: "graphite", showLastSession: "yes", junk: 1 }, updatedAt: "2026-11-21T10:00:00.000Z" });
    expect(changes).toBe(0);
    expect(seen).toBe("graphite");
    expect(settings.get()).toEqual({ theme: "graphite", showLastSession: true });
    // Survives a restart with its timestamp.
    expect(new SettingsService(store, clock).snapshot().updatedAt).toBe("2026-11-21T10:00:00.000Z");
    settings.applyRemote({ values: { theme: "neon" }, updatedAt: "2026-11-21T11:00:00.000Z" });
    expect(settings.get().theme).toBe("oled");
  });

  it("keeps each setting's own stamp from another device's copy, across a restart", () => {
    const store = memoryStore();
    const settings = new SettingsService(store, clock);
    const copy = {
      values: { theme: "graphite", showLastSession: false },
      updatedAt: "2026-11-21T12:00:00.000Z",
      stamps: { theme: "2026-11-21T11:00:00.000Z", showLastSession: "2026-11-21T12:00:00.000Z" },
    };
    settings.applyRemote(copy);
    expect(settings.snapshot()).toEqual(copy);
    expect(new SettingsService(store, clock).snapshot()).toEqual(copy);
  });
});
