import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { TABLES, type TableName } from "../src/data/RecordStore";
import { settle } from "../src/data/recordSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { EPOCH, type Syncable } from "../src/domain/ids";
import type { LoadUnit } from "../src/domain/Load";
import { LocalDate } from "../src/domain/LocalDate";
import { Session, type SessionData } from "../src/domain/Session";
import { SetEntry } from "../src/domain/SetEntry";
import { Split } from "../src/domain/Split";
import { WorkoutDay, type WorkoutDayData } from "../src/domain/WorkoutDay";
import { BackupService } from "../src/services/BackupService";
import { CalendarService } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import type { ImportedLog, ImportPlan } from "../src/services/ImportPlan";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { cleanAccentColor, cleanColor, MIN_ACCENT_ALPHA, SettingsService, withRecentColor } from "../src/services/SettingsService";
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

describe("SetupService day order", () => {
  it("moves a day to a place in the list (a drag), saving only the days whose place changed", async () => {
    const [a, b, c, d] = [await setup.createDay("A"), await setup.createDay("B"), await setup.createDay("C"), await setup.createDay("D")];
    const names = async () => (await setup.days()).map((x) => `${x.name}:${x.order}`);
    const saveMany = vi.spyOn(repos.days, "saveMany");
    const saved = () => saveMany.mock.calls.flatMap(([days]) => days.map((x) => x.name));

    await setup.moveDayTo(d.id, 1);
    expect(await names()).toEqual(["A:0", "D:1", "B:2", "C:3"]);
    expect(saved()).toEqual(["D", "B", "C"]); // A kept its place

    saveMany.mockClear();
    await setup.moveDayTo(b.id, 0);
    expect(await names()).toEqual(["B:0", "A:1", "D:2", "C:3"]);
    expect(saved()).toEqual(["B", "A", "D"]);

    // Past either end: first or last.
    saveMany.mockClear();
    await setup.moveDayTo(a.id, 99);
    expect(await names()).toEqual(["B:0", "D:1", "C:2", "A:3"]);
    expect(saved()).toEqual(["D", "C", "A"]);
    await setup.moveDayTo(c.id, -3);
    expect(await names()).toEqual(["C:0", "B:1", "D:2", "A:3"]);

    // Nothing to move: nothing saved.
    saveMany.mockClear();
    await setup.moveDayTo(c.id, 0);
    await setup.moveDayTo("nope", 2);
    await setup.moveDayTo(b.id, Number.NaN);
    expect(saved()).toEqual([]);
    expect(await names()).toEqual(["C:0", "B:1", "D:2", "A:3"]);
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

  /** The sheet's Lower day: "Leg Press (Plates)" now, "Legpress" an old name for it. */
  const lowerSheet = (...days: [date: string, rows: ImportedLog[]][]): ImportPlan => ({
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
        sessions: days.map(([date, logs]) => ({ date, label: "Mar", logs })),
      },
    ],
  });
  const row = (key: string, weight: number, reps: number): ImportedLog => ({ key, sets: [{ weight, reps }], done: null, note: "" });
  const sheet = lowerSheet(
    ["2026-03-03", [row("legpress", 300, 10)]],
    ["2026-03-10", [row("legpressplates", 2.5, 8), row("legpress", 310, 10)]],
  );
  const summaries = async (dayId: string, exerciseId: string, unit: LoadUnit = "lb") =>
    (await sessions.history(dayId)).map((s) => [s.isoDate, s.log(exerciseId)?.summary(" · ", unit)]);

  it("keeps a merge when the sheet is imported again", async () => {
    const imports = new ImportService(repos);
    await imports.apply(sheet);
    const day = (await setup.days())[0]!;
    const [press, oldPress] = day.allExercises();
    await setup.mergeExercise(day.id, oldPress!.id, press!.id);
    const merged = [["2026-03-03", "300 · 10"], ["2026-03-10", "2.5/310 · 8/10"]];
    expect(await summaries(day.id, press!.id)).toEqual(merged);

    const again = await imports.apply(sheet);
    expect(again.exercisesCreated).toBe(0);
    const after = (await setup.days())[0]!;
    expect(after.allExercises().map((e) => e.name)).toEqual(["Leg Press (Plates)"]);
    // Both names logged on one date: both rows' sets, in the order the merge put them.
    expect(await summaries(day.id, press!.id)).toEqual(merged);

    // Still after renaming what was kept, even to the merged-away name.
    for (const name of ["Leg Press Machine", "Leg Press"]) {
      await setup.updateDay(day.id, (x) => x.withExercise(x.exercise(press!.id)!.renamed(name)));
      expect((await imports.apply(sheet)).exercisesCreated).toBe(0);
      expect(await summaries(day.id, press!.id)).toEqual(merged);
    }
  });

  it("takes TASKS.md §8's order: plates names merged and switched first, then the pounds one", async () => {
    const imports = new ImportService(repos);
    const plan = lowerSheet(
      ["2026-03-03", [row("legpressplates", 2.5, 8)]],
      ["2026-03-10", [row("legpressbusyplates", 3, 8), row("legpress", 300, 10)]],
      ["2026-03-17", [row("legpress", 310, 10)]],
    );
    plan.days[0]!.exercises.push({ key: "legpressbusyplates", name: "Leg Press (Busy)(Plates)", kind: "strength", targetSets: null, targetText: null, active: false });
    await imports.apply(plan);
    const day = (await setup.days())[0]!;
    const byName = (name: string) => day.allExercises().find((e) => e.name === name)!;
    const [press, busy, oldPress] = [byName("Leg Press (Plates)"), byName("Leg Press (Busy)(Plates)"), byName("Legpress")];
    // Both "(Plates)" names hold plate counts, so they can merge first and switch together...
    await setup.mergeExercise(day.id, busy.id, press.id);
    expect(await setup.sessionsLoggedIn(day.id, press.id, "lb")).toBe(2);
    await setup.setUnit(day.id, press.id, "plates", "relabel");
    // ...and only then take in the name logged in pounds.
    await setup.mergeExercise(day.id, oldPress.id, press.id);
    const expected = [["2026-03-03", 230, "2.5 pl"], ["2026-03-10", 300, "300"], ["2026-03-17", 310, "310"]];
    const points = async () =>
      (await new ProgressService(repos, clock).lines(day.id, "ALL")).lines[0]!.points.map((p) => [p.date.toString(), p.weight, p.label]);
    expect(await points()).toEqual(expected);
    expect(await summaries(day.id, press.id, "plates")).toEqual([["2026-03-03", "2.5 pl · 8"], ["2026-03-10", "270/300 · 8/10"], ["2026-03-17", "310 · 10"]]);
    await imports.apply(plan);
    expect(await points()).toEqual(expected);
  });

  it("keeps plates as plates when the merged name only has a note that day", async () => {
    const { day, press, oldPress } = await lowerWithPress();
    await setup.setUnit(day.id, press.id, "plates", "relabel");
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(press.id).withSets(sets(2.5, 10, 10)));
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(oldPress.id).withNote("sled taken").withUnit("lb"));
    await sessions.saveLog(day.id, d("2026-10-20"), ExerciseLog.empty(oldPress.id).withNote("no time").withUnit("lb"));
    await setup.mergeExercise(day.id, oldPress.id, press.id);
    const history = await sessions.history(day.id);
    expect(history.map((s) => [s.log(press.id)?.summary(" · ", "plates"), s.log(press.id)?.unitOr("plates")])).toEqual([
      ["2.5 pl · 10/10", "plates"],
      ["", "plates"], // a note alone: typed weights will be plates, like the rest
    ]);
  });

  it("re-imports each name's rows in the unit it was logged in", async () => {
    // TASKS.md §8: set the "(Plates)" leg press to plates, then merge the pounds one into it.
    const imports = new ImportService(repos);
    await imports.apply(sheet);
    const day = (await setup.days())[0]!;
    const [press, oldPress] = day.allExercises();
    await setup.setUnit(day.id, press!.id, "plates", "relabel");
    await setup.mergeExercise(day.id, oldPress!.id, press!.id);
    const merged = [["2026-03-03", "300 · 10"], ["2026-03-10", "230/310 · 8/10"]]; // pounds stay pounds; 2.5 pl = 230 lb
    expect(await summaries(day.id, press!.id, "plates")).toEqual(merged);

    await imports.apply(sheet);
    expect(await summaries(day.id, press!.id, "plates")).toEqual(merged);
    const [line] = (await new ProgressService(repos, clock).lines(day.id, "ALL")).lines;
    expect(line!.points.map((p) => p.weight)).toEqual([300, 310]); // not 27,000 lb
  });

  it("re-imports a merged name's note-only row without a unit, like the merge filed it", async () => {
    const imports = new ImportService(repos);
    const plan = lowerSheet(
      ["2026-03-03", [row("legpressplates", 2.5, 8)]],
      ["2026-03-10", [{ key: "legpress", sets: [], done: null, note: "sled taken" }]],
    );
    await imports.apply(plan);
    const day = (await setup.days())[0]!;
    const [press, oldPress] = day.allExercises();
    await setup.setUnit(day.id, press!.id, "plates", "relabel");
    await setup.mergeExercise(day.id, oldPress!.id, press!.id);
    const noteDay = async () => (await sessions.find(day.id, d("2026-03-10")))!.log(press!.id)!;
    expect([(await noteDay()).note, (await noteDay()).unit]).toEqual(["sled taken", undefined]);

    await imports.apply(plan);
    // Weights typed into that day later are plates, like the rest of the exercise.
    expect([(await noteDay()).note, (await noteDay()).unit]).toEqual(["sled taken", undefined]);
  });

  it("re-imports rows in pounds after switching to plates with \"keep those in pounds\"", async () => {
    const imports = new ImportService(repos);
    const plan = lowerSheet(["2026-03-03", [row("legpressplates", 360, 10)]]);
    await imports.apply(plan);
    const day = (await setup.days())[0]!;
    const press = day.activeExercises()[0]!;
    await setup.setUnit(day.id, press.id, "plates", "keep");
    await imports.apply(plan);
    const bare = (await setup.days())[0]!.exercise(press.id)!.bareUnit;
    expect(bare).toBe("lb");
    expect(await summaries(day.id, press.id, bare)).toEqual([["2026-03-03", "360 · 10"]]);
  });
});

describe("Units per log", () => {
  async function legPress() {
    let day = await setup.createDay("Lower");
    day = (await setup.updateDay(day.id, (x) => x.addExercise("Leg press")))!;
    return { day, press: day.activeExercises()[0]! };
  }
  const points = async (dayId: string) =>
    (await new ProgressService(repos, clock).lines(dayId, "ALL")).lines[0]!.points.map((p) => [p.date.toString(), p.weight, p.label]);

  it("switching to plates leaves earlier pounds in pounds", async () => {
    const { day, press } = await legPress();
    // Saved before units were stored (no unit on the log), like every log so far.
    await sessions.saveLog(day.id, d("2026-11-10"), ExerciseLog.empty(press.id).withSets(sets(360, 10)));
    expect(await setup.sessionsLoggedIn(day.id, press.id, "lb")).toBe(1);
    await setup.setUnit(day.id, press.id, "plates", "keep");
    expect(await setup.sessionsLoggedIn(day.id, press.id, "lb")).toBe(1);
    await sessions.saveLog(day.id, d("2026-11-17"), ExerciseLog.empty(press.id).withSets(sets(4, 8)).withUnit("plates"));

    expect(await points(day.id)).toEqual([["2026-11-10", 360, "360"], ["2026-11-17", 360, "4 pl"]]);
    // The row's "Last: 360 – 10" (not "360 pl"): a log saved without a unit reads in the exercise's bareUnit.
    const last = await sessions.lastResultsBefore(day.id, d("2026-11-17"));
    const exercise = (await setup.days())[0]!.exercise(press.id)!;
    expect([exercise.unit, exercise.bareUnit]).toEqual(["plates", "lb"]);
    expect(last.get(press.id)?.log.summary(" – ", exercise.bareUnit)).toBe("360 – 10");

    // And back to pounds: the plates day stays plates.
    expect(await setup.sessionsLoggedIn(day.id, press.id, "plates")).toBe(1);
    await setup.setUnit(day.id, press.id, "lb", "keep");
    expect(await points(day.id)).toEqual([["2026-11-10", 360, "360"], ["2026-11-17", 360, "4 pl"]]);
  });

  it("relabels earlier sessions that were plates all along", async () => {
    const { day, press } = await legPress();
    await sessions.saveLog(day.id, d("2026-11-10"), ExerciseLog.empty(press.id).withSets(sets(2.5, 10))); // an imported "(Plates)" row
    await sessions.saveLog(day.id, d("2026-11-11"), ExerciseLog.empty(press.id).withNote("sled taken")); // no weights: nothing to ask about
    expect(await setup.sessionsLoggedIn(day.id, press.id, "lb")).toBe(1);
    await setup.setUnit(day.id, press.id, "plates", "relabel");
    expect(await points(day.id)).toEqual([["2026-11-10", 230, "2.5 pl"]]);
    expect(await setup.sessionsLoggedIn(day.id, press.id, "lb")).toBe(0);
  });

  it("fixes a wrong \"keep\" by switching back and answering \"those were plates\"", async () => {
    const { day, press } = await legPress();
    await sessions.saveLog(day.id, d("2026-11-10"), ExerciseLog.empty(press.id).withSets(sets(2.5, 10)));
    await setup.setUnit(day.id, press.id, "plates", "keep"); // oops: those were plates
    expect(await points(day.id)).toEqual([["2026-11-10", 2.5, "2.5"]]);
    expect(await setup.sessionsLoggedIn(day.id, press.id, "plates")).toBe(0); // so switching back doesn't ask
    await setup.setUnit(day.id, press.id, "lb", "relabel");
    expect(await setup.sessionsLoggedIn(day.id, press.id, "lb")).toBe(1);
    await setup.setUnit(day.id, press.id, "plates", "relabel");
    expect(await points(day.id)).toEqual([["2026-11-10", 230, "2.5 pl"]]);
  });

  it("merges across units without mixing them", async () => {
    let day = await setup.createDay("Lower");
    day = (await setup.updateDay(day.id, (x) => x.addExercise("Leg Press (Plates)").addExercise("Legpress")))!;
    const [press, oldPress] = day.allExercises();
    await sessions.saveLog(day.id, d("2026-10-06"), ExerciseLog.empty(oldPress!.id).withSets(sets(300, 10)));
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(oldPress!.id).withSets(sets(310, 8)));
    await sessions.saveLog(day.id, d("2026-10-13"), ExerciseLog.empty(press!.id).withSets(sets(2.5, 10)));
    await setup.setUnit(day.id, press!.id, "plates", "relabel");
    await setup.mergeExercise(day.id, oldPress!.id, press!.id);

    expect(await points(day.id)).toEqual([["2026-10-06", 300, "300"], ["2026-10-13", 310, "310"]]);
    const history = await sessions.history(day.id);
    expect(history.map((s) => s.log(press!.id)?.summary(" · ", "plates"))).toEqual(["300 · 10", "230/310 · 10/8"]);
    // Switching the merged exercise later only asks about what's really in its unit.
    expect(await setup.sessionsLoggedIn(day.id, press!.id, "plates")).toBe(0);
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

  it("charts every weight in kilograms or pounds, whatever it was logged in", async () => {
    const { day, pull } = await upperDay();
    let lower = await setup.createDay("Lower");
    lower = (await setup.updateDay(lower.id, (x) => x.addExercise("Leg press")))!;
    const press = lower.activeExercises()[0]!;
    await setup.setUnit(lower.id, press.id, "plates", "relabel");
    await sessions.saveLog(day.id, d("2026-11-09"), ExerciseLog.empty(pull.id).withSets(sets(185, 6))); // saved without a unit: pounds
    await sessions.saveLog(day.id, d("2026-11-16"), ExerciseLog.empty(pull.id).withSets(sets(80, 8)).withUnit("kg"));
    await sessions.saveLog(lower.id, d("2026-11-17"), ExerciseLog.empty(press.id).withSets(sets(2.5, 10)).withUnit("plates"));
    const progress = new ProgressService(repos, clock);
    const point = async (dayId: string, unit: "lb" | "kg") =>
      (await progress.lines(dayId, "1M", unit)).lines[0]!.points.map((p) => [p.weight, p.label, p.summary]);

    expect(await point(day.id, "kg")).toEqual([
      [84, "84", "185 lb (84 kg) · 6"],
      [80, "80", "80 kg · 8"],
    ]);
    expect(await point(day.id, "lb")).toEqual([
      [185, "185", "185 · 6"],
      [176.5, "176.5", "80 kg (176.5 lb) · 8"],
    ]);
    expect(await point(lower.id, "kg")).toEqual([[104.5, "2.5 pl", "2.5 pl (104.5 kg) · 10"]]);
  });
});

describe("Kilograms while logging", () => {
  it("saves the kg / lb switch on the workout day from that exercise down, converting nothing", async () => {
    const { day, pull, tri } = await upperDay();
    await sessions.saveLog(day.id, d("2026-11-16"), ExerciseLog.empty(tri.id).withSets(sets(50, 10))); // pounds, saved without a unit
    await setup.setWeightUnitFrom(day.id, pull.id, "kg");
    const units = async () => (await setup.days())[0]!.activeExercises().map((e) => e.unit);
    expect(await units()).toEqual(["kg", "kg"]);
    // Triceps' Nov 16 is still pounds.
    const history = await sessions.history(day.id);
    const triceps = (await setup.days())[0]!.exercise(tri.id)!;
    expect(history[0]!.log(tri.id)?.summary(" · ", triceps.bareUnit)).toBe("50 · 10");
    await setup.setWeightUnitFrom(day.id, tri.id, "lb");
    expect(await units()).toEqual(["kg", "lb"]);
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

describe("Logs that sync in after a merge or delete", () => {
  interface Device {
    store: MemoryRecordStore;
    repos: StoreRepositories;
    setup: SetupService;
    sessions: SessionService;
  }
  let now: number;
  const worldClock: Clock = { now: () => new Date(now) };
  /**
   * Stand-in for Supabase: an upload replaces the server's copy unless it is older (the keep_newest
   * trigger), and a download settles with the device's copy by SupabaseSync.apply's rule (settle):
   * a local copy that wins a tie is queued to go up again.
   */
  let server: Map<string, { table: TableName; record: Syncable }>;

  beforeEach(() => {
    now = Date.parse("2026-11-18T08:00:00.000Z");
    server = new Map();
  });

  function device(): Device {
    const store = new MemoryRecordStore();
    const repos = new StoreRepositories(store, worldClock);
    return { store, repos, setup: new SetupService(repos), sessions: new SessionService(repos) };
  }

  /**
   * Push this device's outbox, then pull and settle, the way SupabaseSync does; a local copy that
   * won a tie is queued again and goes up on a sync right after, as SupabaseSync's does. A minute passes.
   */
  async function sync({ store }: Device): Promise<void> {
    for (let round = 0; round < 3; round++) {
      const outbox = await store.outbox();
      for (const entry of outbox) {
        const record = await store.get(entry.table, entry.id);
        const held = server.get(`${entry.table}/${entry.id}`);
        if (record && (!held || Date.parse(record.updatedAt) >= Date.parse(held.record.updatedAt))) {
          server.set(`${entry.table}/${entry.id}`, { table: entry.table, record: structuredClone(record) });
        }
      }
      await store.clearOutbox(outbox);
      const waiting = new Set((await store.outbox()).map((e) => `${e.table}/${e.id}`));
      let requeued = false;
      for (const table of TABLES) {
        const taken: Syncable[] = [];
        const again: Syncable[] = [];
        for (const { table: t, record } of server.values()) {
          if (t !== table) continue;
          const local = await store.get(table, record.id);
          const outcome = settle(record, local, waiting.has(`${table}/${record.id}`));
          if (outcome === "take") taken.push(structuredClone(record));
          if (outcome === "push" && local) again.push(local);
        }
        if (taken.length) await store.putMany(table, taken, "remote");
        if (again.length) await store.putMany(table, again, "local");
        requeued ||= again.length > 0;
      }
      if (!requeued) break;
    }
    now += 60_000;
  }

  async function lowerOnBoth(...names: string[]) {
    const desktop = device();
    const phone = device();
    let day = await desktop.setup.createDay("Lower");
    day = (await desktop.setup.updateDay(day.id, (x) => names.reduce((acc, name) => acc.addExercise(name), x)))!;
    await sync(desktop);
    await sync(phone);
    return { desktop, phone, day, exercises: day.allExercises() };
  }

  it("files a log saved on another device before it heard about a merge", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Leg Press", "Legpress");
    const [press, oldPress] = exercises;
    await desktop.sessions.saveLog(day.id, d("2026-11-17"), ExerciseLog.empty(press!.id).withSets(sets(310, 8)));
    // Offline at the gym, the phone logs the old name while the desktop merges it away.
    await phone.sessions.saveLog(day.id, d("2026-11-18"), ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    now += 60_000;
    await desktop.setup.mergeExercise(day.id, oldPress!.id, press!.id);
    await sync(desktop);
    await sync(phone);
    await sync(desktop);

    // Left alone, the log points at nothing: invisible, yet the day counts as a workout.
    expect((await desktop.sessions.find(day.id, d("2026-11-18")))?.logs.map((l) => l.exerciseId)).toEqual([oldPress!.id]);

    for (const dev of [desktop, phone]) expect(await dev.setup.reconcile()).toBe(1);
    for (const dev of [desktop, phone]) {
      const late = await dev.sessions.find(day.id, d("2026-11-18"));
      expect(late?.logs.map((l) => [l.exerciseId, l.summary()])).toEqual([[press!.id, "320 · 10"]]);
      const [line] = (await new ProgressService(dev.repos, clock).lines(day.id, "1M")).lines;
      expect(line!.points.map((p) => p.weight)).toEqual([310, 320]);
    }

    // The repairs sync without ping-pong: once both have each other's copy, nothing is left to do.
    await sync(desktop);
    await sync(phone);
    await sync(desktop);
    for (const dev of [desktop, phone]) {
      expect(await dev.setup.reconcile()).toBe(0);
      expect(await dev.store.outbox()).toEqual([]);
    }
  });

  it("drops a log saved on another device before it heard about a delete", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Legpress", "Squat");
    const [oldPress, squat] = exercises;
    await phone.sessions.saveLog(day.id, d("2026-11-18"), ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    await phone.sessions.saveLog(day.id, d("2026-11-19"), ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    await phone.sessions.saveLog(day.id, d("2026-11-19"), ExerciseLog.empty(squat!.id).withSets(sets(225, 5)));
    now += 60_000;
    await desktop.setup.deleteExercise(day.id, oldPress!.id);
    await sync(desktop);
    await sync(phone);
    await sync(desktop);

    for (const dev of [desktop, phone]) {
      expect(await dev.setup.reconcile()).toBe(2);
      // The day that only had the deleted exercise is gone (no green dot); the other keeps its squat.
      const history = await dev.sessions.history(day.id);
      expect(history.map((s) => [s.isoDate, s.logs.map((l) => l.exerciseId)])).toEqual([["2026-11-19", [squat!.id]]]);
      const [nov18] = await new CalendarService(dev.repos, clock).range(d("2026-11-18"), d("2026-11-18"));
      expect(nov18!.status).toBe("rest");
      expect(await dev.setup.reconcile()).toBe(0);
    }
  });

  it("never lets a repair made elsewhere beat edits made after the copy it repaired", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Leg Press", "Legpress", "Squat");
    const [press, oldPress, squat] = exercises;
    const date = d("2026-11-18");
    // The desktop merges the old name away; at the gym the phone hasn't heard and logs it.
    await desktop.setup.mergeExercise(day.id, oldPress!.id, press!.id);
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(squat!.id).withSets(sets(225, 5)));
    await sync(desktop);
    // A moment of signal: the phone uploads that copy, hears about the merge and files its log,
    // then loses signal before the repair goes up and logs more sets (the app is suspended after).
    await sync(phone);
    expect(await phone.setup.reconcile()).toBe(1);
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(press!.id).withSets(sets(320, 10, 8)));
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(squat!.id).withSets(sets(225, 5, 5)));
    // Hours later the desktop downloads the phone's first copy and repairs it too.
    now += 2 * 3_600_000;
    await sync(desktop);
    expect(await desktop.setup.reconcile()).toBe(1);
    await sync(desktop);
    // When the phone is back, its later copy wins on both devices.
    await sync(phone);
    await sync(desktop);
    for (const dev of [desktop, phone]) {
      const session = await dev.sessions.find(day.id, date);
      const summaries = new Map(session?.logs.map((l) => [l.exerciseId, l.summary()]));
      expect(summaries).toEqual(new Map([[press!.id, "320 · 10/8"], [squat!.id, "225 · 5/5"]]));
      expect(await dev.setup.reconcile()).toBe(0);
    }
  });

  it("keeps \"keep those in pounds\" when a device that hadn't heard of it saves an older session", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Leg press", "Squat");
    const [press, squat] = exercises;
    const date = d("2026-11-10");
    // Pounds saved without a unit (an imported row, or a log from before units were stored).
    await desktop.sessions.saveLog(day.id, date, ExerciseLog.empty(press!.id).withSets(sets(300, 10)));
    await desktop.sessions.saveLog(day.id, date, ExerciseLog.empty(squat!.id).withSets(sets(225, 5)));
    await sync(desktop);
    await sync(phone);
    // The phone switches to plates and keeps the old sessions in pounds...
    await phone.setup.setUnit(day.id, press!.id, "plates", "keep");
    await sync(phone);
    // ...while the desktop, not synced since, adds a note to that day: the whole session goes up again.
    await desktop.sessions.saveLog(day.id, date, ExerciseLog.empty(squat!.id).withSets(sets(225, 5)).withNote("belt"));
    await sync(desktop);
    await sync(phone);
    for (const dev of [desktop, phone]) {
      const line = (await new ProgressService(dev.repos, clock).lines(day.id, "ALL")).lines.find((l) => l.exercise.id === press!.id);
      expect(line!.points.map((p) => [p.date.toString(), p.weight, p.label])).toEqual([["2026-11-10", 300, "300"]]); // not 27,000 lb
      expect((await dev.sessions.find(day.id, date))!.log(squat!.id)!.note).toBe("belt");
    }
  });

  it("keeps \"those were plates\" when a device that hadn't heard of it edits the day", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Leg press", "Calf");
    const [press] = exercises;
    // An imported 3 × 10 (saved without a unit) and one logged in the app in pounds.
    await desktop.sessions.saveLog(day.id, d("2026-11-03"), ExerciseLog.empty(press!.id).withSets(sets(3, 10)));
    await desktop.sessions.saveLog(day.id, d("2026-11-10"), ExerciseLog.empty(press!.id).withSets(sets(3, 10)).withUnit("lb"));
    await sync(desktop);
    await sync(phone);
    await desktop.setup.setUnit(day.id, press!.id, "plates", "relabel");
    await sync(desktop);
    // The phone, not synced since, edits the day: its copy of the day goes up again, still in pounds.
    await phone.setup.updateDay(day.id, (x) => x.addExercise("Hack squat"));
    await sync(phone);
    await sync(desktop);
    for (const dev of [desktop, phone]) {
      const line = (await new ProgressService(dev.repos, clock).lines(day.id, "ALL")).lines.find((l) => l.exercise.id === press!.id);
      expect(line!.points.map((p) => [p.date.toString(), p.weight, p.label])).toEqual([
        ["2026-11-03", 270, "3 pl"],
        ["2026-11-10", 270, "3 pl"],
      ]);
    }
  });

  for (const done of [true, false]) {
    it(`never loses a late ${done ? "Done" : "Skipped"} to a drop repair when the merge won`, async () => {
      const [desktop, phone, laptop] = [device(), device(), device()];
      let day = await desktop.setup.createDay("Abs");
      day = (await desktop.setup.updateDay(day.id, (x) => x.addExercise("Crunch").addExercise("Cardio treadmill", "check").addExercise("Cardio walk", "check")))!;
      for (const dev of [desktop, phone, laptop]) await sync(dev);
      const [crunch, treadmill, walk] = day.allExercises();
      const date = d("2026-11-18");
      await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(crunch!.id).withSets(sets(20, 8)));
      await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(walk!.id).withDone(done));
      await sync(phone);
      // Both offline: the desktop deletes Walk, then the laptop merges it into Treadmill (the later day edit).
      await desktop.setup.deleteExercise(day.id, walk!.id);
      now += 60_000;
      await laptop.setup.mergeExercise(day.id, walk!.id, treadmill!.id);
      await sync(desktop);
      expect(await desktop.setup.reconcile()).toBe(1);
      await sync(laptop);
      expect(await laptop.setup.reconcile()).toBe(1);
      for (const dev of [laptop, desktop, phone, laptop, desktop, phone]) {
        await sync(dev);
        await dev.setup.reconcile();
      }
      for (const dev of [laptop, desktop, phone]) {
        const logs = (await dev.sessions.find(day.id, date))?.logs.map((l) => [l.exerciseId, l.summary()]);
        expect(logs).toEqual([[crunch!.id, "20 · 8"], [treadmill!.id, done ? "Done" : "Skipped"]]);
        expect(await dev.store.outbox()).toEqual([]);
      }
    });
  }

  it("never writes a repair over a save that landed while it ran", async () => {
    /** Runs `during` once, after reading the sessions and before answering (a save landing mid-read). */
    class SaveDuringRead extends MemoryRecordStore {
      during: (() => Promise<unknown>) | null = null;
      override async getAll<T extends Syncable>(table: TableName): Promise<T[]> {
        const rows = await super.getAll<T>(table);
        const during = this.during;
        if (table === "sessions" && during) {
          this.during = null;
          await during();
        }
        return rows;
      }
    }
    const store = new SaveDuringRead();
    const repos = new StoreRepositories(store, worldClock);
    const setup = new SetupService(repos);
    const sessions = new SessionService(repos);
    let day = await setup.createDay("Lower");
    day = (await setup.updateDay(day.id, (x) => x.addExercise("Leg Press").addExercise("Legpress").addExercise("Squat")))!;
    const [press, oldPress, squat] = day.allExercises();
    const date = d("2026-11-18");
    await sessions.saveLog(day.id, date, ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    await sessions.saveLog(day.id, date, ExerciseLog.empty(squat!.id).withSets(sets(225, 5)));
    // A merge synced in from another device: the day knows, this session's log doesn't yet.
    await repos.days.save((await repos.days.get(day.id))!.mergeExercise(oldPress!.id, press!.id));
    now += 60_000;
    // The squat editor's save lands while reconcile reads the sessions.
    store.during = () => sessions.saveLog(day.id, date, ExerciseLog.empty(squat!.id).withSets(sets(225, 5, 5)));
    const before = Date.parse((await sessions.find(day.id, date))!.updatedAt);

    expect(await setup.reconcile()).toBe(1);
    const session = (await sessions.find(day.id, date))!;
    expect(new Map(session.logs.map((l) => [l.exerciseId, l.summary()]))).toEqual(
      new Map([[press!.id, "320 · 10"], [squat!.id, "225 · 5/5"]]),
    );
    expect(Date.parse(session.updatedAt)).toBeGreaterThan(before);
    expect((await store.outbox()).find((e) => e.table === "sessions")?.updatedAt).toBe(session.updatedAt);
  });

  it("puts every device on the copy that kept the late log when two repaired it differently", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Leg Press", "Legpress");
    const [press, oldPress] = exercises;
    const laptop = device();
    await sync(laptop);
    const date = d("2026-11-18");
    // Offline at the gym, the phone logs both names; then it uploads that copy.
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(press!.id).withSets(sets(300, 10)));
    await sync(phone);
    // Before either hears of the other, the laptop merges the old name away and the desktop deletes it.
    await laptop.setup.mergeExercise(day.id, oldPress!.id, press!.id);
    now += 60_000;
    await desktop.setup.deleteExercise(day.id, oldPress!.id);
    // Each downloads the phone's copy and repairs it its own way, with the same stamp.
    await sync(laptop);
    await sync(desktop);
    expect(await laptop.setup.reconcile()).toBe(1);
    expect(await desktop.setup.reconcile()).toBe(1);
    const shown = async (dev: Device) => (await dev.sessions.find(day.id, date))?.logs.map((l) => [l.exerciseId, l.summary()]);
    expect(await shown(laptop)).toEqual([[press!.id, "300/320 · 10/10"]]);
    expect(await shown(desktop)).toEqual([[press!.id, "300 · 10"]]);

    // The desktop's repair reaches the server last, but the laptop's kept the late set: a round of
    // syncs later, everyone has the laptop's, and nothing is left to upload or repair.
    for (const dev of [laptop, desktop, phone, laptop, desktop, phone]) await sync(dev);
    for (const dev of [laptop, desktop, phone]) {
      expect(await shown(dev)).toEqual([[press!.id, "300/320 · 10/10"]]);
      expect(await dev.setup.reconcile()).toBe(0);
      expect(await dev.store.outbox()).toEqual([]);
    }
  });

  it("never loses a late log to a drop repair that uploaded last when the merge won", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Leg Press", "Legpress");
    const [press, oldPress] = exercises;
    const laptop = device();
    await sync(laptop);
    const date = d("2026-11-18");
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(press!.id).withSets(sets(300, 10)));
    await sync(phone);
    // Both offline: the desktop deletes the old name, then the laptop merges it (the later day edit).
    await desktop.setup.deleteExercise(day.id, oldPress!.id);
    now += 60_000;
    await laptop.setup.mergeExercise(day.id, oldPress!.id, press!.id);
    // The desktop syncs first and drops the late log, but its repair waits to upload...
    await sync(desktop);
    expect(await desktop.setup.reconcile()).toBe(1);
    // ...while the laptop's merge wins the day, files the late log and uploads that.
    await sync(laptop);
    expect(await laptop.setup.reconcile()).toBe(1);
    await sync(laptop);
    // The desktop's drop reaches the server last.
    await sync(desktop);
    for (const dev of [laptop, phone, desktop, laptop, phone, desktop]) {
      await sync(dev);
      await dev.setup.reconcile();
    }
    const shown = async (dev: Device) => (await dev.sessions.find(day.id, date))?.logs.map((l) => [l.exerciseId, l.summary()]);
    for (const dev of [laptop, desktop, phone]) {
      expect((await dev.setup.days())[0]!.retiredExercises()).toEqual([{ id: oldPress!.id, mergedInto: press!.id, unit: "lb" }]);
      expect(await shown(dev)).toEqual([[press!.id, "300/320 · 10/10"]]);
      expect(await dev.store.outbox()).toEqual([]);
    }
  });

  it("drops an open editor's last save for a merged-away exercise once its log was filed", async () => {
    const { desktop, phone, day, exercises } = await lowerOnBoth("Leg Press", "Legpress");
    const [press, oldPress] = exercises;
    const date = d("2026-11-18");
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10)));
    await desktop.setup.mergeExercise(day.id, oldPress!.id, press!.id);
    await sync(desktop);
    await sync(phone); // the merge arrives while the phone's Legpress row is open
    const logs = async () => (await phone.sessions.find(day.id, date))?.logs.map((l) => [l.exerciseId, l.summary()]);

    // A save before the log is filed replaces it, and is filed once.
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10, 8)));
    expect(await phone.setup.reconcile()).toBe(1);
    expect(await logs()).toEqual([[press!.id, "320 · 10/8"]]);
    // The row is gone now; its editor flushes the draft it held as it closes. Nothing is filed twice.
    await phone.sessions.saveLog(day.id, date, ExerciseLog.empty(oldPress!.id).withSets(sets(320, 10, 8, 6)));
    expect(await phone.setup.reconcile()).toBe(0);
    expect(await logs()).toEqual([[press!.id, "320 · 10/8"]]);
  });

  it("follows merges of merges and keeps a late log's unit", async () => {
    let day = await setup.createDay("Lower");
    day = (await setup.updateDay(day.id, (x) => x.addExercise("Sled").addExercise("Legpress").addExercise("Leg Press")))!;
    const [sled, oldPress, press] = day.allExercises();
    await setup.setUnit(day.id, sled!.id, "plates", "relabel");
    await sessions.saveLog(day.id, d("2026-11-17"), ExerciseLog.empty(press!.id).withSets(sets(300, 10)));
    await setup.mergeExercise(day.id, sled!.id, oldPress!.id);
    await setup.mergeExercise(day.id, oldPress!.id, press!.id);

    // A newer copy of the day arrives from a phone that logged the sled (in plates, with no unit saved).
    const late = (await sessions.find(day.id, d("2026-11-17")))!
      .withLog(ExerciseLog.empty(sled!.id).withSets(sets(2.5, 8)))
      .withUpdatedAt("2026-11-21T00:00:00.000Z");
    await store.putMany("sessions", [late.toJSON()], "remote");

    expect(await setup.reconcile()).toBe(1);
    const log = (await sessions.find(day.id, d("2026-11-17")))!.log(press!.id)!;
    expect([log.unit, log.summary()]).toEqual(["lb", "300/230 · 10/8"]); // 2.5 pl = 230 lb
    expect(await setup.reconcile()).toBe(0);
  });

  it("leaves logs it can't place, and returns at once when nothing was merged or deleted", async () => {
    const { day, pull } = await upperDay();
    await sessions.saveLog(day.id, d("2026-11-16"), ExerciseLog.empty(pull.id).withSets(sets(150, 8)));
    const before = await store.outbox();
    expect(await setup.reconcile()).toBe(0);
    expect(await store.outbox()).toEqual(before);

    // Two merges pointing at each other (hand-made data): no safe answer, so a log that syncs in stays.
    await repos.days.save(WorkoutDay.from({ ...day.toJSON(), retired: [{ id: "x", mergedInto: "y" }, { id: "y", mergedInto: "x" }] }));
    const late = (await sessions.find(day.id, d("2026-11-16")))!.withLog(ExerciseLog.empty("x").withSets(sets(100, 5)));
    await store.putMany("sessions", [late.withUpdatedAt("2026-11-21T00:00:00.000Z").toJSON()], "remote");
    expect(await setup.reconcile()).toBe(0);
    expect((await sessions.find(day.id, d("2026-11-16")))?.log("x")?.summary()).toBe("100 · 5");
  });

  it("brings a deleted exercise back from the sheet as a new one that its tombstone never touches", async () => {
    const imports = new ImportService(repos);
    const plan: ImportPlan = {
      source: "test.xlsx",
      split: [null, null, null, null, null, null, null],
      warnings: [],
      skippedCopies: 0,
      days: [
        {
          name: "Lower",
          exercises: [{ key: "legpress", name: "Legpress", kind: "strength", targetSets: null, targetText: null, active: true }],
          sessions: [{ date: "2026-03-03", label: "Mar", logs: [{ key: "legpress", sets: [{ weight: 300, reps: 10 }], done: null, note: "" }] }],
        },
      ],
    };
    await imports.apply(plan);
    const day = (await setup.days())[0]!;
    const gone = day.activeExercises()[0]!;
    await setup.deleteExercise(day.id, gone.id);
    expect(await sessions.history(day.id)).toEqual([]);

    expect((await imports.apply(plan)).exercisesCreated).toBe(1);
    const back = (await setup.days())[0]!.activeExercises()[0]!;
    expect(back.id).not.toBe(gone.id);
    expect(await setup.reconcile()).toBe(0);
    expect((await sessions.history(day.id)).map((s) => s.log(back.id)?.summary())).toEqual(["300 · 10"]);
  });
});

describe("BackupService", () => {
  it("exports each log's unit, each exercise's units, and the merged and deleted exercises", async () => {
    const { day, pull, tri } = await upperDay();
    await sessions.saveLog(day.id, d("2026-11-16"), ExerciseLog.empty(pull.id).withSets(sets(150, 8)));
    await setup.setUnit(day.id, pull.id, "plates", "keep");
    await sessions.saveLog(day.id, d("2026-11-17"), ExerciseLog.empty(pull.id).withSets(sets(2, 8)).withUnit("plates"));
    await setup.deleteExercise(day.id, tri.id);
    const backup = JSON.parse(await new BackupService(repos).exportJson()) as { workoutDays: WorkoutDayData[]; sessions: SessionData[] };
    expect(backup.sessions.map((s) => s.logs[0]!.unit)).toEqual([undefined, "plates"]);
    expect(backup.workoutDays[0]!.retired).toEqual([{ id: tri.id }]);
    expect(backup.workoutDays[0]!.exercises[0]).toMatchObject({ unit: "plates", bareUnit: "lb", keyUnits: { pulldown: "lb" } });
  });
});

describe("SettingsService", () => {
  const memoryStore = (initial?: object): KeyValueStore => {
    const map = new Map<string, string>(initial ? [["gym-tracker.settings", JSON.stringify(initial)]] : []);
    return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
  };
  /** Every setting at its default, and each one's stamp while untouched. */
  const DEFAULT_VALUES = {
    theme: "oled",
    customThemeColor: null,
    accent: "blue",
    customAccentColor: null,
    recentThemeColors: [],
    recentAccentColors: [],
    showLastSession: true,
    progressUnit: "lb",
    restSeconds: 90,
  };
  const UNTOUCHED = Object.fromEntries(Object.keys(DEFAULT_VALUES).map((k) => [k, EPOCH]));

  it("stamps changes for sync and tells sync about them", () => {
    const settings = new SettingsService(memoryStore(), clock);
    expect(settings.snapshot().updatedAt).toBe(EPOCH); // untouched defaults
    let changes = 0;
    settings.onLocalChange(() => changes++);
    settings.update({ theme: "sand" });
    expect(changes).toBe(1);
    const now = clock.now().toISOString();
    expect(settings.snapshot()).toEqual({
      values: { ...DEFAULT_VALUES, theme: "sand" },
      updatedAt: now,
      stamps: { ...UNTOUCHED, theme: now }, // only the setting that changed
    });
  });

  it("never stamps a change earlier than the stamp it replaces", () => {
    const settings = new SettingsService(memoryStore(), clock);
    const ahead = new Date(clock.now().getTime() + 3_600_000); // copied from a device whose clock is an hour fast
    settings.applyRemote({ values: { theme: "midnight" }, updatedAt: ahead.toISOString() });
    settings.update({ theme: "oled" });
    expect(settings.snapshot().stamps).toEqual({ ...UNTOUCHED, theme: new Date(ahead.getTime() + 1).toISOString() });
  });

  it("dates choices saved before sync just after the epoch, so any real change wins", () => {
    const settings = new SettingsService(memoryStore({ theme: "graphite" }), clock);
    expect(settings.get().theme).toBe("graphite");
    expect(settings.snapshot().updatedAt).toBe("1970-01-01T00:00:00.001Z");
  });

  it("dates settings saved before per-setting stamps by their copy's time, and survives damaged times", () => {
    const older = new SettingsService(memoryStore({ theme: "graphite", showLastSession: false, updatedAt: "2026-11-21T10:00:00Z" }), clock);
    expect(older.snapshot().stamps).toEqual({ ...UNTOUCHED, theme: "2026-11-21T10:00:00.000Z", showLastSession: "2026-11-21T10:00:00.000Z" });
    // A setting missing from the saved copy (added in a later version) was never chosen here.
    const missing = new SettingsService(memoryStore({ theme: "graphite", updatedAt: "2026-11-21T10:00:00.000Z" }), clock);
    expect(missing.snapshot().stamps).toEqual({ ...UNTOUCHED, theme: "2026-11-21T10:00:00.000Z" });
    const damaged = new SettingsService(memoryStore({ theme: "graphite", updatedAt: "soon", stamps: { theme: 42, showLastSession: "later" } }), clock);
    expect(damaged.snapshot().updatedAt).toBe("1970-01-01T00:00:00.001Z");
    damaged.update({ showLastSession: false });
    expect(damaged.snapshot().stamps).toEqual({ ...UNTOUCHED, theme: "1970-01-01T00:00:00.001Z", showLastSession: clock.now().toISOString() });
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
    // Graphite from before accents were a setting still shows its blue.
    expect(settings.get()).toEqual({ ...DEFAULT_VALUES, theme: "graphite", accent: "blue" });
    // Survives a restart with its timestamp.
    expect(new SettingsService(store, clock).snapshot().updatedAt).toBe("2026-11-21T10:00:00.000Z");
    // A theme this version doesn't know (a later version's) leaves this one, and its stamp, alone.
    settings.applyRemote({ values: { theme: "neon" }, updatedAt: "2026-11-21T11:00:00.000Z" });
    expect(settings.get().theme).toBe("graphite");
    expect(settings.snapshot().stamps?.theme).toBe("2026-11-21T10:00:00.000Z");
  });

  it("keeps each setting's own stamp from another device's copy, across a restart", () => {
    const store = memoryStore();
    const settings = new SettingsService(store, clock);
    const copy = {
      values: {
        ...DEFAULT_VALUES,
        theme: "graphite",
        showLastSession: false,
        accent: "custom",
        customAccentColor: "#12345680",
        recentAccentColors: ["#12345680", "#abcdef"],
      },
      updatedAt: "2026-11-21T12:00:00.000Z",
      stamps: {
        ...UNTOUCHED,
        theme: "2026-11-21T11:00:00.000Z",
        showLastSession: "2026-11-21T12:00:00.000Z",
        accent: "2026-11-21T11:30:00.000Z",
        customAccentColor: "2026-11-21T11:30:00.000Z",
        recentAccentColors: "2026-11-21T11:30:00.000Z",
      },
    };
    settings.applyRemote(copy);
    expect(settings.snapshot()).toEqual(copy);
    expect(new SettingsService(store, clock).snapshot()).toEqual(copy);
  });

  it("shows Blue until an accent is picked, whatever an older version stored as the default, and a theme change keeps it", () => {
    // New: OLED and Blue.
    const fresh = new SettingsService(memoryStore(), clock);
    expect(fresh.get()).toMatchObject({ theme: "oled", accent: "blue" });

    // Saved before D58 with Lime as the untouched default (stamped at the epoch), or by v0.3.0
    // before accents were a setting: Blue now, while what's stored is sent on unchanged.
    const untouched = { ...UNTOUCHED, theme: "2026-11-21T10:00:00.000Z" };
    const limeDefault = new SettingsService(memoryStore({ ...DEFAULT_VALUES, accent: "lime", updatedAt: untouched.theme, stamps: untouched }), clock);
    expect(limeDefault.get().accent).toBe("blue");
    expect(limeDefault.snapshot().values.accent).toBe("lime");
    const v030 = new SettingsService(memoryStore({ theme: "sand", showLastSession: true, updatedAt: "2026-11-21T10:00:00.000Z" }), clock);
    expect(v030.get()).toMatchObject({ theme: "sand", accent: "blue" });

    // Lime from another device's untouched default is still Blue here; Lime picked there is Lime.
    limeDefault.applyRemote({ values: { accent: "lime" }, updatedAt: EPOCH, stamps: { accent: EPOCH } });
    expect(limeDefault.get().accent).toBe("blue");
    limeDefault.applyRemote({ values: { accent: "lime" }, updatedAt: "2026-11-21T11:00:00.000Z", stamps: { accent: "2026-11-21T11:00:00.000Z" } });
    expect(limeDefault.get().accent).toBe("lime");

    // A theme change stamps only the theme; the accent on screen stays.
    const light = new SettingsService(memoryStore(), clock);
    light.update({ theme: "graphite" });
    expect(light.get()).toMatchObject({ theme: "graphite", accent: "blue" });
    expect(light.snapshot().stamps?.accent).toBe(EPOCH);

    // Picked accents stay put.
    const picked = new SettingsService(memoryStore(), clock);
    picked.update({ accent: "teal" });
    picked.update({ theme: "graphite" });
    expect(picked.get().accent).toBe("teal");
  });

  it("saves custom colors and recent lists, and drops junk from a damaged copy", () => {
    const settings = new SettingsService(memoryStore(), clock);
    settings.update({ theme: "custom", customThemeColor: "#1A2B3C", recentThemeColors: ["#1A2B3C"] });
    expect(settings.get()).toMatchObject({ theme: "custom", customThemeColor: "#1a2b3c", recentThemeColors: ["#1a2b3c"] });
    settings.update({ accent: "custom", customAccentColor: "#ff8800ff" }); // fully opaque: stored without alpha
    expect(settings.get()).toMatchObject({ accent: "custom", customAccentColor: "#ff8800" });

    const before = settings.snapshot().stamps!;
    settings.applyRemote({
      values: {
        customThemeColor: "red",
        recentThemeColors: ["#111111", "nope", 7, "#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
        recentAccentColors: "#123456",
        accent: "custom",
        customAccentColor: { r: 1 },
      },
      updatedAt: "2026-11-21T10:00:00.000Z",
    });
    const s = settings.get();
    // A color it can't read leaves the good one here, so Custom keeps showing it; a list keeps its
    // valid colors.
    expect(s).toMatchObject({ theme: "custom", customThemeColor: "#1a2b3c", accent: "custom", customAccentColor: "#ff8800", recentAccentColors: [] });
    expect(s.recentThemeColors).toEqual(["#111111", "#222222", "#333333", "#444444", "#555555"]);
    // The skipped settings keep their own stamps, so the next sync can't send a fallback for them
    // back to the account as the newest copy.
    const after = settings.snapshot().stamps!;
    for (const k of ["customThemeColor", "customAccentColor", "recentAccentColors"] as const) expect(after[k], k).toBe(before[k]);
    expect(after.recentThemeColors).toBe("2026-11-21T10:00:00.000Z");
    expect(after.accent).toBe("2026-11-21T10:00:00.000Z");
  });

  it("doesn't let a damaged copy erase a custom color or flip Custom to OLED, here or on the account", () => {
    const settings = new SettingsService(memoryStore(), clock);
    settings.update({ theme: "custom", customThemeColor: "#5a2e18" });
    const later = new Date(clock.now().getTime() + 60_000).toISOString();
    const junk = { values: { theme: "custom", customThemeColor: "oklch(40% 0.1 40)" }, updatedAt: later, stamps: { theme: later, customThemeColor: later } };
    settings.applyRemote(junk);
    expect(settings.get()).toMatchObject({ theme: "custom", customThemeColor: "#5a2e18" });
    // What goes back to the account still carries the good color.
    expect(settings.snapshot().values).toMatchObject({ theme: "custom", customThemeColor: "#5a2e18" });
    // Custom with no color anywhere isn't taken either: the theme here stays.
    const plain = new SettingsService(memoryStore(), clock);
    plain.update({ theme: "sand" });
    plain.applyRemote({ values: { theme: "custom", customThemeColor: null }, updatedAt: later });
    expect(plain.get().theme).toBe("sand");
    // A real change from another device still comes through.
    settings.applyRemote({ values: { customThemeColor: "#0b1a2e" }, updatedAt: later, stamps: { customThemeColor: later } });
    expect(settings.get()).toMatchObject({ theme: "custom", customThemeColor: "#0b1a2e" });
  });

  it("raises a Custom accent too see-through to show to the picker's lowest opacity, stored or synced", () => {
    expect(MIN_ACCENT_ALPHA).toBe(0.2);
    expect(cleanAccentColor("#ff000000")).toBe("#ff000033");
    expect(cleanAccentColor("#ff000032")).toBe("#ff000033");
    expect(cleanAccentColor("#ff000033")).toBe("#ff000033");
    expect(cleanAccentColor("#FF000080")).toBe("#ff000080");
    expect(cleanAccentColor("#ff0000")).toBe("#ff0000");
    expect(cleanAccentColor("red")).toBeNull();
    const settings = new SettingsService(memoryStore({ accent: "custom", customAccentColor: "#3d7bff00", recentAccentColors: ["#3d7bff00"] }), clock);
    expect(settings.get()).toMatchObject({ accent: "custom", customAccentColor: "#3d7bff33", recentAccentColors: ["#3d7bff33"] });
    settings.applyRemote({ values: { customAccentColor: "#12345605" }, updatedAt: "2026-11-21T10:00:00.000Z" });
    expect(settings.get().customAccentColor).toBe("#12345633");
    // A theme can be fully see-through: that is plain black or white.
    settings.update({ theme: "custom", customThemeColor: "#12345600" });
    expect(settings.get().customThemeColor).toBe("#12345600");
  });

  it("keeps recent colors newest first, without repeats, five at most", () => {
    let list: string[] = [];
    for (const c of ["#111111", "#222222", "#333333", "#111111", "#444444", "#555555", "#666666"]) list = withRecentColor(list, c);
    expect(list).toEqual(["#666666", "#555555", "#444444", "#111111", "#333333"]);
    expect(withRecentColor(list, "#444444")).toEqual(["#444444", "#666666", "#555555", "#111111", "#333333"]);
    expect(withRecentColor([], "#ABCDEF")).toEqual(["#abcdef"]);
  });

  it("cleans colors to lowercase #rrggbb or #rrggbbaa", () => {
    expect(cleanColor("#ABCDEF")).toBe("#abcdef");
    expect(cleanColor("#abcdef80")).toBe("#abcdef80");
    expect(cleanColor("#abcdefFF")).toBe("#abcdef");
    for (const bad of ["abcdef", "#abc", "#abcdeg", "#abcdef8", "", null, 42, ["#abcdef"]]) expect(cleanColor(bad)).toBeNull();
  });
});
