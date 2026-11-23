import { describe, expect, it } from "vitest";
import { dayStatus } from "../src/domain/DayStatus";
import { Exercise } from "../src/domain/Exercise";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { convertLoad, formatLoad, platesToPounds } from "../src/domain/Load";
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

  it("scales each half on its own plate, so more plates always weigh more", () => {
    expect(platesToPounds(1.75)).toBe(160); // halfway from 1.5 (140) to 2 (180)
    expect(platesToPounds(1.95)).toBe(176);
    expect(platesToPounds(2)).toBe(180);
    expect(platesToPounds(2.75)).toBe(250); // halfway from 2.5 (230) to 3 (270)
    expect(platesToPounds(2.95)).toBe(266);
    expect(platesToPounds(1.25)).toBe(115); // halfway from 1 (90) to 1.5 (140)
    expect(platesToPounds(0.07)).toBe(7); // no float noise in stored conversions
    for (let p = 0; p < 5; p = Math.round((p + 0.05) * 100) / 100) {
      expect(platesToPounds(p + 0.05)).toBeGreaterThan(platesToPounds(p));
    }
  });

  it("converts between units only when it's exact", () => {
    expect(convertLoad(2.5, "plates", "lb")).toBe(230);
    expect(convertLoad(185, "lb", "lb")).toBe(185);
    expect(convertLoad(2.5, "plates", "plates")).toBe(2.5);
    expect(convertLoad(230, "lb", "plates")).toBeNull(); // which plates? not guessed
  });

  it("converts pounds and kilograms both ways to the nearest half, and plates to kilograms through pounds", () => {
    expect(convertLoad(185, "lb", "kg")).toBe(84); // 83.91
    expect(convertLoad(80, "kg", "lb")).toBe(176.5); // 176.37
    expect(convertLoad(100, "kg", "lb")).toBe(220.5);
    expect(convertLoad(45, "lb", "kg")).toBe(20.5); // 20.41
    expect(convertLoad(2.5, "plates", "kg")).toBe(104.5); // 230 lb = 104.33 kg
    expect(convertLoad(2.5, "plates", "lb")).toBe(230); // still exact
    expect(convertLoad(80, "kg", "plates")).toBeNull();
    expect(formatLoad(84, "kg")).toBe("84 kg");
  });
});

describe("Kilograms", () => {
  it("shows last time's weights in another unit, or as saved when that would be a guess", () => {
    const pounds = ExerciseLog.empty("x").withSets([new SetEntry(185, 6), new SetEntry(175, 6)]).withUnit("lb");
    const inKg = pounds.inUnit("kg", "lb");
    expect([inKg.unit, inKg.summary(" – ")]).toEqual(["kg", "84/79.5 kg – 6/6"]);
    expect(pounds.inUnit("lb", "lb")).toBe(pounds);
    expect(pounds.inUnit("plates", "lb")).toBe(pounds); // pounds → plates isn't guessed
    // A log saved without a unit reads in the exercise's bareUnit.
    const unmarked = ExerciseLog.empty("x").withSets([new SetEntry(80, 8)]);
    expect(unmarked.inUnit("lb", "kg").summary(" – ")).toBe("176.5 – 8");
    // Bodyweight reps and notes have nothing to convert.
    const bodyweight = ExerciseLog.empty("x").withSets([new SetEntry(null, 12)]);
    expect(bodyweight.inUnit("kg", "lb")).toBe(bodyweight);
  });

  it("switches the unit from one exercise down, passing over plates and done / not done exercises", () => {
    let day = WorkoutDay.create("Upper", 0);
    for (const name of ["Pulldown", "Press", "Leg press", "Walk", "Curl", "Raise"]) day = day.addExercise(name);
    const [pull, press, legs, walk, curl, raise] = day.activeExercises();
    day = day.withExercise(legs!.withUnit("plates", "relabel")).withExercise(walk!.with({ kind: "check" }));
    const units = (d: WorkoutDay) => d.activeExercises().map((e) => e.unit);

    const kg = day.withWeightUnitFrom(pull!.id, "kg");
    expect(units(kg)).toEqual(["kg", "kg", "plates", "lb", "kg", "kg"]); // Walk has no weights: untouched
    // The fifth back to pounds: the fifth and sixth follow, the ones above stay in kilos.
    const mixed = kg.withWeightUnitFrom(curl!.id, "lb");
    expect(units(mixed)).toEqual(["kg", "kg", "plates", "lb", "lb", "lb"]);
    // From the middle: only that one and below.
    expect(units(day.withWeightUnitFrom(press!.id, "kg"))).toEqual(["lb", "kg", "plates", "lb", "kg", "kg"]);
    // Nothing to change: the same day.
    expect(mixed.withWeightUnitFrom(raise!.id, "lb")).toBe(mixed);
    // Logs saved before the switch keep reading in pounds, and switching back stores nothing extra.
    const switched = kg.exercise(pull!.id)!;
    expect(switched.bareUnit).toBe("lb");
    const back = kg.withWeightUnitFrom(pull!.id, "lb").exercise(pull!.id)!;
    expect([back.unit, back.bareUnit]).toEqual(["lb", "lb"]);
    expect(Object.keys(back.toJSON())).not.toContain("bareUnit");
    expect(Object.keys(back.toJSON())).not.toContain("keyUnits");
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

    // A recorded Done survives, whichever side it's on.
    const skipped = ExerciseLog.empty("walk").withDone(false);
    const done = ExerciseLog.empty("cardio").withDone(true);
    expect(skipped.mergedWith(done).done).toBe(true);
    expect(done.mergedWith(skipped).done).toBe(true);
    expect(skipped.mergedWith(ExerciseLog.empty("x")).done).toBe(false);
    expect(ExerciseLog.empty("x").mergedWith(skipped).done).toBe(false);
  });

  it("keeps the unit its weights were saved in", () => {
    const pounds = log([[360, 10]]).withUnit("lb");
    expect(pounds.unit).toBe("lb");
    // The exercise's unit only covers logs saved without one.
    expect(pounds.weightLabel("plates")).toBe("360");
    expect(pounds.summary(" – ", "plates")).toBe("360 – 10");
    expect(log([[4, 8]]).weightLabel("plates")).toBe("4 pl");
    expect(pounds.unitOr("plates")).toBe("lb");
    expect(log([[4, 8]]).unitOr("plates")).toBe("plates");
    // Survives every edit, and storage.
    const edited = pounds.withSets([new SetEntry(365, 9)]).withNote("deep").withDone(null).withExerciseId("y");
    expect(edited.unit).toBe("lb");
    expect(ExerciseLog.from(edited.toJSON()).unit).toBe("lb");
    expect(JSON.parse(JSON.stringify(pounds.toJSON()))).toMatchObject({ unit: "lb" });
    // Logs saved before units were stored read as before and stay that way.
    expect(log([[100, 5]]).toJSON()).not.toHaveProperty("unit");
    expect(ExerciseLog.from({ exerciseId: "x", sets: [{ weight: 2.5, reps: 8 }], done: null, note: "" }).unit).toBeUndefined();
  });

  it("combines logs in different units in pounds", () => {
    const plates = log([[2.5, 10], [null, 12]]).withUnit("plates");
    const pounds = ExerciseLog.empty("y").withSets([new SetEntry(310, 8)]).withUnit("lb");
    const merged = plates.mergedWith(pounds);
    expect(merged.unit).toBe("lb");
    expect(merged.sets.map((s) => s.weight)).toEqual([230, null, 310]); // 2.5 pl = 230 lb; bodyweight stays
    // A log saved without a unit counts as the exercise's.
    const legacy = log([[2.5, 10]]);
    expect(legacy.mergedWith(pounds, "plates").sets.map((s) => s.weight)).toEqual([230, 310]);
    expect(legacy.mergedWith(pounds, "lb").sets.map((s) => s.weight)).toEqual([2.5, 310]);
    expect(legacy.mergedWith(log([[3, 8]]), "plates").unit).toBeUndefined(); // same unit: nothing to convert
  });

  it("converts nothing when one side has no weights", () => {
    const plates = log([[2.5, 10], [2.5, 10]]).withUnit("plates");
    const note = ExerciseLog.empty("y").withNote("sled taken").withUnit("lb");
    const bodyweight = ExerciseLog.empty("y").withSets([new SetEntry(null, 12)]).withUnit("lb");
    expect(plates.mergedWith(note).summary()).toBe("2.5 pl · 10/10");
    expect(plates.mergedWith(bodyweight).summary()).toBe("2.5/2.5/BW pl · 10/10/12");
    expect(note.mergedWith(plates)).toMatchObject({ unit: "plates", note: "sled taken" });
    // A log saved without a unit still follows the exercise.
    expect(log([[2.5, 10]]).mergedWith(note, "plates").unit).toBeUndefined();
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
    day = day.moveExerciseTo(c!.id, 1);
    expect(day.activeExercises().map((e) => e.name)).toEqual(["A", "C", "B"]);
    day = day.archiveExercise(a!.id);
    expect(day.activeExercises().map((e) => e.name)).toEqual(["C", "B"]);
    expect(day.allExercises()).toHaveLength(3);
    expect(WorkoutDay.from(day.toJSON()).toJSON()).toEqual(day.toJSON());
  });

  it("moves an active exercise to a place in the list (a drag), clamped, with removed ones kept after", () => {
    let day = WorkoutDay.create("Upper 1", 0).addExercise("A").addExercise("B").addExercise("C").addExercise("D");
    const [a, b, c, d] = day.allExercises();
    day = day.archiveExercise(b!.id); // removed, between A and C
    const names = (x: WorkoutDay) => x.allExercises().map((e) => `${e.name}${e.archived ? " (removed)" : ""}`);

    expect(names(day.moveExerciseTo(d!.id, 0))).toEqual(["D", "A", "C", "B (removed)"]);
    expect(names(day.moveExerciseTo(a!.id, 2))).toEqual(["C", "D", "A", "B (removed)"]);
    expect(names(day.moveExerciseTo(a!.id, 1))).toEqual(["C", "A", "D", "B (removed)"]);
    // Past either end: first or last. Places count active exercises only.
    expect(names(day.moveExerciseTo(c!.id, 99))).toEqual(["A", "D", "C", "B (removed)"]);
    expect(names(day.moveExerciseTo(c!.id, -5))).toEqual(["C", "A", "D", "B (removed)"]);
    // Nothing to move: the same day.
    expect(day.moveExerciseTo(c!.id, 1)).toBe(day);
    expect(day.moveExerciseTo(b!.id, 0)).toBe(day); // removed
    expect(day.moveExerciseTo("nope", 0)).toBe(day);
    expect(day.moveExerciseTo(c!.id, Number.NaN)).toBe(day);
    // Immutable: the original keeps its order.
    expect(names(day)).toEqual(["A", "B (removed)", "C", "D"]);
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
    const lbs = { from: "lb", into: "lb" } as const;
    const only = Session.start("day", date).withLog(ExerciseLog.empty("old").withSets([new SetEntry(2, 8)]));
    expect(only.mergeLogs("old", "new", lbs).logs.map((l) => l.exerciseId)).toEqual(["new"]);

    const both = only.withLog(ExerciseLog.empty("new").withSets([new SetEntry(270, 10)]));
    const merged = both.mergeLogs("old", "new", lbs);
    expect(merged.logs).toHaveLength(1);
    expect(merged.log("new")?.repsLabel()).toBe("10/8");
    expect(both.withoutLog("old").logs.map((l) => l.exerciseId)).toEqual(["new"]);
  });

  it("keeps each moved log's unit, and combines a day in two units in pounds", () => {
    const date = LocalDate.parse("2026-11-17");
    const pounds = Session.start("day", date).withLog(ExerciseLog.empty("old").withSets([new SetEntry(300, 10)]));
    // "old" was logged in pounds; the target is a plates exercise: the moved log says so.
    const moved = pounds.mergeLogs("old", "new", { from: "lb", into: "plates" }).log("new")!;
    expect(moved.unit).toBe("lb");
    expect(moved.weightLabel("plates")).toBe("300");

    const both = pounds.withLog(ExerciseLog.empty("new").withSets([new SetEntry(2.5, 8)]));
    const combined = both.mergeLogs("old", "new", { from: "lb", into: "plates" }).log("new")!;
    expect(combined.unit).toBe("lb");
    expect(combined.summary()).toBe("230/300 · 8/10");

    // A log without weights has no unit to keep: it follows the exercise it moves to.
    const note = Session.start("day", date).withLog(ExerciseLog.empty("old").withNote("sled taken").withUnit("lb"));
    expect(note.mergeLogs("old", "new", { from: "lb", into: "plates" }).log("new")?.unit).toBeUndefined();
  });

  it("remembers merged and deleted exercises apart from the list", () => {
    let day = WorkoutDay.create("Lower", 0).addExercise("Leg Press").addExercise("Legpress").addExercise("Squat").addExercise("Hack");
    const [press, oldPress, squat, hack] = day.allExercises();
    day = day.withExercise(oldPress!.with({ unit: "plates" }));
    day = day.mergeExercise(oldPress!.id, press!.id).removeExercise(hack!.id);
    expect(day.allExercises().map((e) => e.name)).toEqual(["Leg Press", "Squat"]);
    expect(day.retiredExercises()).toEqual([{ id: oldPress!.id, mergedInto: press!.id, unit: "plates" }, { id: hack!.id }]);
    expect(day.retiredFate(oldPress!.id)).toEqual({ kind: "merge", into: day.exercise(press!.id), unit: "plates" });
    expect(day.retiredFate(hack!.id)).toEqual({ kind: "drop" });
    expect(day.retiredFate(squat!.id)).toBeUndefined(); // still on the day
    expect(day.retiredFate("never-heard-of-it")).toBeUndefined();
    expect([oldPress, hack, squat].map((e) => day.isRetired(e!.id))).toEqual([true, true, false]);
    // Survives storage, and a stale edit can't bring a merged exercise back.
    expect(WorkoutDay.from(day.toJSON()).retiredExercises()).toEqual(day.retiredExercises());
    expect(day.withExercise(oldPress!.with({ targetSets: 3 }))).toBe(day);
    expect(day.removeExercise("never-heard-of-it")).toBe(day);
  });

  it("follows merges of merges, and stops at deletes and loops", () => {
    let day = WorkoutDay.create("Lower", 0).addExercise("A").addExercise("B").addExercise("C");
    const [a, b, c] = day.allExercises();
    day = day.mergeExercise(a!.id, b!.id).mergeExercise(b!.id, c!.id);
    expect(day.retiredFate(a!.id)).toEqual({ kind: "merge", into: day.exercise(c!.id), unit: "lb" });
    expect(day.removeExercise(c!.id).retiredFate(a!.id)).toEqual({ kind: "drop" });
    // Two merges that point at each other (only possible in hand-made data) have no answer.
    const loop = WorkoutDay.from({
      ...WorkoutDay.create("Loop", 0).toJSON(),
      retired: [{ id: "x", mergedInto: "y" }, { id: "y", mergedInto: "x" }],
    });
    expect(loop.retiredFate("x")).toBeUndefined();
    // Merged into something that's gone without a trace: leave it be.
    const lost = WorkoutDay.from({ ...WorkoutDay.create("Lost", 0).toJSON(), retired: [{ id: "x", mergedInto: "gone" }] });
    expect(lost.retiredFate("x")).toBeUndefined();
  });

  it("lands a merged exercise's sheet names in the unit it was logged in", () => {
    const plates = Exercise.create("Leg Press (Plates)").with({ unit: "plates" });
    const pounds = Exercise.create("Legpress").renamed("Leg press machine");
    const merged = plates.withNamesOf(pounds);
    expect(merged.aliases).toEqual(["legpressmachine", "legpress"]);
    expect(merged.unitOf("legpress")).toBe("lb");
    expect(merged.unitOf("legpressmachine")).toBe("lb");
    expect(merged.unitOf(merged.key)).toBe("plates");
    expect(Exercise.from(merged.toJSON()).unitOf("legpress")).toBe("lb");
  });

  it("orders a merged exercise's sheet names as the merge combined them, through renames", () => {
    const order = (ex: Exercise, keys: string[]) => [...keys].sort((a, b) => ex.rowOrder(a) - ex.rowOrder(b));
    const merged = Exercise.create("Leg Press (Plates)").withNamesOf(Exercise.create("Legpress"));
    const keys = ["legpress", "legpressplates"];
    expect(order(merged, keys)).toEqual(["legpressplates", "legpress"]);
    expect(order(merged.renamed("Leg Press Machine"), keys)).toEqual(["legpressplates", "legpress"]);
    expect(order(merged.renamed("Leg Press"), keys)).toEqual(["legpressplates", "legpress"]); // now the merged name
    expect(order(Exercise.from(merged.renamed("Leg Press").toJSON()), keys)).toEqual(["legpressplates", "legpress"]);
    // Merges of merges: what was kept, then what it took in, then what that had taken in.
    const chain = Exercise.create("A").withNamesOf(Exercise.create("B").withNamesOf(Exercise.create("C")));
    expect(order(chain, ["c", "b", "a"])).toEqual(["a", "b", "c"]);
    // Merged before the order was stored: its own name, then the others as added.
    const older = Exercise.from({ ...Exercise.create("Leg Press (Plates)").toJSON(), aliases: ["legpress"] });
    expect(order(older, keys)).toEqual(["legpressplates", "legpress"]);
  });
});

describe("Switching an exercise's unit", () => {
  it("keeps the names logged so far in the old unit, or relabels them", () => {
    const ex = Exercise.create("Leg press").renamed("Leg press machine");
    const kept = ex.withUnit("plates", "keep");
    expect(kept.unit).toBe("plates");
    expect(kept.unitOf(kept.key)).toBe("lb");
    expect(kept.unitOf("legpress")).toBe("lb");
    const relabeled = ex.withUnit("plates", "relabel");
    expect(relabeled.unitOf(relabeled.key)).toBe("plates");
    expect(relabeled.toJSON()).not.toHaveProperty("keyUnits");
    // Switching back after "keep": everything is in pounds again, nothing left to pin.
    expect(kept.withUnit("lb", "keep").toJSON()).not.toHaveProperty("keyUnits");
    expect(kept.withUnit("lb", "relabel").unitOf(kept.key)).toBe("lb");
    expect(ex.withUnit("lb", "keep")).toBe(ex);
  });

  it("remembers on the exercise what its logs saved without a unit are", () => {
    const press = Exercise.create("Leg press");
    expect([press.unit, press.bareUnit]).toEqual(["lb", "lb"]);
    const kept = press.withUnit("plates", "keep");
    expect([kept.unit, kept.bareUnit, kept.toJSON().bareUnit]).toEqual(["plates", "lb", "lb"]);
    // Back to pounds either way: everything unmarked is pounds again, nothing stored.
    expect(kept.withUnit("lb", "keep").toJSON()).not.toHaveProperty("bareUnit");
    expect(kept.withUnit("lb", "relabel").toJSON()).not.toHaveProperty("bareUnit");
    // "Those were plates": they were plates all along.
    const relabeled = press.withUnit("plates", "relabel");
    expect([relabeled.unit, relabeled.bareUnit]).toEqual(["plates", "plates"]);
    expect(relabeled.toJSON()).not.toHaveProperty("bareUnit");
    // A wrong "keep" fixed by switching back and answering "those were plates".
    expect(kept.withUnit("lb", "relabel").withUnit("plates", "relabel").bareUnit).toBe("plates");
    // A merged exercise's tombstone keeps the unit its unmarked logs are in.
    const day = WorkoutDay.create("Lower", 0).withExercise(kept).addExercise("Sled");
    const sled = day.activeExercises()[1]!;
    expect(day.mergeExercise(kept.id, sled.id).retiredExercises()).toEqual([{ id: kept.id, mergedInto: sled.id, unit: "lb" }]);
  });

  it("never gives a log without weights a unit", () => {
    const note = ExerciseLog.empty("x").withNote("seat 4").withUnit("lb");
    expect(note.unit).toBeUndefined();
    expect(note.toJSON()).not.toHaveProperty("unit");
    const bodyweight = ExerciseLog.from({ exerciseId: "x", sets: [{ weight: null, reps: 10 }], done: null, note: "", unit: "plates" });
    expect(bodyweight.unit).toBeUndefined();
    const lifted = note.withSets([new SetEntry(2.5, 8)]).withUnit("plates");
    expect(lifted.unit).toBe("plates");
    expect(lifted.withSets([new SetEntry(null, 8)]).unit).toBeUndefined();
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
