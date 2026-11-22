import { describe, expect, it } from "vitest";
import { dayStatus } from "../src/domain/DayStatus";
import { Exercise } from "../src/domain/Exercise";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { formatLoad, platesToPounds } from "../src/domain/Load";
import { LocalDate } from "../src/domain/LocalDate";
import { Session } from "../src/domain/Session";
import { SetEntry } from "../src/domain/SetEntry";
import { Split } from "../src/domain/Split";
import { WorkoutDay } from "../src/domain/WorkoutDay";

describe("LocalDate", () => {
  it("parses, formats, and does date math", () => {
    const d = LocalDate.parse("2026-11-20");
    expect(d.toString()).toBe("2026-11-20");
    expect(d.weekday()).toBe(4); // Friday
    expect(d.startOfWeek().toString()).toBe("2026-11-16");
    expect(d.addDays(12).toString()).toBe("2026-12-02");
    expect(LocalDate.parse("2026-03-31").addMonths(-1).toString()).toBe("2026-02-28");
    expect(d.label()).toBe("Fri, Nov 20");
    expect(d.labelWithWeek()).toBe("Fri, Nov 20 | Week 47");
  });

  it("computes ISO week numbers", () => {
    expect(LocalDate.parse("2026-11-20").isoWeek()).toBe(47);
    expect(LocalDate.parse("2027-01-01").isoWeek()).toBe(53);
    expect(LocalDate.parse("2026-01-01").isoWeek()).toBe(1);
  });
});

describe("Exercise", () => {
  it("matches names across spelling differences", () => {
    expect(Exercise.keyOf("Tricep Pushdown")).toBe(Exercise.keyOf("tricep push down"));
    expect(Exercise.keyOf("pulldown (2)")).toBe(Exercise.keyOf("Pulldown"));
    expect(Exercise.keyOf("JM press(smith)")).not.toBe(Exercise.keyOf("JM press"));
  });

  it("keeps old names as aliases when renamed", () => {
    const ex = Exercise.create("Legpress");
    expect(ex.unit).toBe("lb");
    const renamed = ex.renamed("Leg Press (plates)");
    expect(renamed.name).toBe("Leg Press (plates)");
    expect(renamed.answersTo(Exercise.keyOf("legpress"))).toBe(true);
    expect(renamed.answersTo(Exercise.keyOf("leg press (plates)"))).toBe(true);
    expect(renamed.renamed("leg press (plates)").aliases).toEqual(["legpress"]); // same key: nothing new
    expect(ex.renamed("  ")).toBe(ex);
    // Records saved before units and aliases existed still read fine.
    const old = Exercise.from({ id: "x", name: "Squat", kind: "strength", targetSets: 3, targetReps: "8", targetText: null, archived: false });
    expect(old.unit).toBe("lb");
    expect(old.aliases).toEqual([]);
  });

  it("labels targets", () => {
    const ex = Exercise.create("Squat").with({ targetSets: 3, targetReps: "8" });
    expect(ex.targetLabel()).toBe("3×8");
    expect(Exercise.create("Cardio", "check").with({ targetText: "45 min walk" }).targetLabel()).toBe("45 min walk");
  });
});

describe("Plates", () => {
  it("converts plates per side to pounds on both sides", () => {
    expect(platesToPounds(2.5)).toBe(230); // 2 × 45 + 25 a side
    expect(platesToPounds(3)).toBe(270);
    expect(platesToPounds(0.5)).toBe(50);
    expect(platesToPounds(1.5)).toBe(140);
    expect(formatLoad(2.5, "plates")).toBe("2.5 pl");
    expect(formatLoad(185, "lb")).toBe("185");
  });
});

describe("ExerciseLog", () => {
  const log = (sets: [number | null, number | null][]) =>
    ExerciseLog.empty("x").withSets(sets.map(([w, r]) => new SetEntry(w, r)));

  it("summarizes like the sheet", () => {
    expect(log([[135, 8], [135, 8], [135, 7]]).summary()).toBe("135 · 8/8/7");
    expect(log([[20, 8], [20, 6], [20, 6]]).summary(" – ")).toBe("20 – 8/6/6");
    expect(log([[72.5, 5], [65, 6]]).weightLabel()).toBe("72.5/65");
    expect(log([[null, 12], [null, 12]]).weightLabel()).toBe("BW");
  });

  it("labels plates", () => {
    expect(log([[2.5, 8], [2.5, 6]]).weightLabel("plates")).toBe("2.5 pl");
    expect(log([[3, 8], [2.5, 6]]).summary(" – ", "plates")).toBe("3/2.5 pl – 8/6");
    expect(log([[null, 12]]).weightLabel("plates")).toBe("BW");
  });

  it("merges two logs of the same day", () => {
    const a = log([[100, 8]]).withNote("felt good");
    const b = ExerciseLog.empty("y").withSets([new SetEntry(110, 6)]).withNote("new machine");
    const merged = a.mergedWith(b);
    expect(merged.exerciseId).toBe("x");
    expect(merged.repsLabel()).toBe("8/6");
    expect(merged.note).toBe("felt good\nnew machine");
    expect(b.withExerciseId("z").exerciseId).toBe("z");
  });

  it("uses the heaviest set for progress", () => {
    expect(log([[185, 10], [210, 10]]).topWeight()).toBe(210);
    expect(log([[null, 12]]).topWeight()).toBeNull();
  });

  it("knows what counts as a workout", () => {
    expect(ExerciseLog.empty("x").withDone(true).hasResult()).toBe(true);
    expect(ExerciseLog.empty("x").withDone(false).hasResult()).toBe(false);
    expect(ExerciseLog.empty("x").withNote("too sore").hasContent()).toBe(true);
  });
});

describe("WorkoutDay", () => {
  it("adds, moves, and archives exercises without losing them", () => {
    let day = WorkoutDay.create("Upper 1", 0).addExercise("A").addExercise("B").addExercise("C");
    const [a, , c] = day.activeExercises();
    day = day.moveExercise(c!.id, -1);
    expect(day.activeExercises().map((e) => e.name)).toEqual(["A", "C", "B"]);
    day = day.archiveExercise(a!.id);
    expect(day.activeExercises().map((e) => e.name)).toEqual(["C", "B"]);
    expect(day.allExercises()).toHaveLength(3);
    expect(WorkoutDay.from(day.toJSON()).toJSON()).toEqual(day.toJSON());
  });
});

describe("Merging and removing exercises", () => {
  it("folds one exercise into another and finds it by its old name", () => {
    let day = WorkoutDay.create("Lower", 0).addExercise("Leg Press (Plates)").addExercise("Legpress").addExercise("Squat");
    const [press, oldPress, squat] = day.allExercises();
    expect(day.exerciseByKey(Exercise.keyOf("Legpress"))?.id).toBe(oldPress!.id);
    day = day.archiveExercise(oldPress!.id).mergeExercise(oldPress!.id, press!.id);
    expect(day.allExercises().map((e) => e.name)).toEqual(["Leg Press (Plates)", "Squat"]);
    expect(day.exerciseByKey(Exercise.keyOf("Legpress"))?.id).toBe(press!.id);
    expect(day.exerciseByKey(Exercise.keyOf("Squat"))?.id).toBe(squat!.id);
    expect(day.mergeExercise(press!.id, press!.id)).toBe(day);
  });

  it("brings a removed exercise back to the end of the list", () => {
    let day = WorkoutDay.create("Upper", 0).addExercise("A").addExercise("B").addExercise("C");
    const [a] = day.activeExercises();
    day = day.archiveExercise(a!.id);
    expect(day.activeExercises().map((e) => e.name)).toEqual(["B", "C"]);
    day = day.restoreExercise(a!.id);
    expect(day.activeExercises().map((e) => e.name)).toEqual(["B", "C", "A"]);
    expect(day.removeExercise(a!.id).allExercises()).toHaveLength(2);
  });

  it("moves a session's log to the merged exercise", () => {
    const date = LocalDate.parse("2026-11-17");
    const only = Session.start("day", date).withLog(ExerciseLog.empty("old").withSets([new SetEntry(2, 8)]));
    expect(only.mergeLogs("old", "new").logs.map((l) => l.exerciseId)).toEqual(["new"]);

    const both = only.withLog(ExerciseLog.empty("new").withSets([new SetEntry(270, 10)]));
    const merged = both.mergeLogs("old", "new");
    expect(merged.logs).toHaveLength(1);
    expect(merged.log("new")?.repsLabel()).toBe("10/8");
    expect(both.withoutLog("old").logs.map((l) => l.exerciseId)).toEqual(["new"]);
  });
});

describe("Session", () => {
  it("has one id per workout day per date and drops empty logs", () => {
    const s = Session.start("day", LocalDate.parse("2026-11-20"));
    expect(s.id).toBe("day:2026-11-20");
    const withLog = s.withLog(ExerciseLog.empty("e").withSets([new SetEntry(100, 5)]));
    expect(withLog.isWorkout()).toBe(true);
    expect(withLog.withLog(ExerciseLog.empty("e")).logs).toHaveLength(0);
  });
});

describe("Split and day status", () => {
  const split = Split.empty().withWeekday(0, "upper1").withWeekday(1, "lower").withWeekday(4, "lower");
  const today = LocalDate.parse("2026-11-20");
  const start = LocalDate.parse("2026-11-01");

  it("finds planned and rest days", () => {
    expect(split.plannedFor(LocalDate.parse("2026-11-17"))).toBe("lower");
    expect(split.weekdaysFor("lower")).toEqual([1, 4]);
    expect(split.restWeekdays()).toEqual([2, 3, 5, 6]);
  });

  it("marks missed only for past planned days after tracking started", () => {
    const facts = { today, trackingStart: start };
    expect(dayStatus({ ...facts, date: LocalDate.parse("2026-11-17"), planned: true, workedOut: false })).toBe("missed");
    expect(dayStatus({ ...facts, date: LocalDate.parse("2026-11-17"), planned: true, workedOut: true })).toBe("done");
    expect(dayStatus({ ...facts, date: LocalDate.parse("2026-11-18"), planned: false, workedOut: false })).toBe("rest");
    expect(dayStatus({ ...facts, date: today, planned: true, workedOut: false })).toBe("planned");
    expect(dayStatus({ ...facts, date: LocalDate.parse("2026-10-06"), planned: true, workedOut: false })).toBe("rest");
  });
});
