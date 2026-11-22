import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { LocalDate } from "../src/domain/LocalDate";
import { SetEntry } from "../src/domain/SetEntry";
import { CalendarService } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import type { ImportPlan } from "../src/services/ImportPlan";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { SetupService } from "../src/services/SetupService";
import type { Clock } from "../src/services/ports";

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
