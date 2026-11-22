import { describe, expect, it } from "vitest";
import { alignSets, decodeDate, parseDone, parseNumberList } from "../src/importers/cellParsers";
import { Grid, type CellValue } from "../src/importers/Grid";
import { MonthGridImporter } from "../src/importers/MonthGridImporter";

describe("cell parsing", () => {
  it("reads weights and reps the way they're typed in the sheet", () => {
    expect(parseNumberList("72.5/65").values).toEqual([72.5, 65]);
    expect(parseNumberList("10/10/9.5").values).toEqual([10, 10, 9.5]);
    expect(parseNumberList("25 lbs")).toEqual({ values: [25], bodyweight: false, extra: null });
    expect(parseNumberList("35(down)")).toEqual({ values: [35], bodyweight: false, extra: "35(down)" });
    expect(parseNumberList("Body Weight").bodyweight).toBe(true);
    expect(parseNumberList("No straps")).toEqual({ values: [], bodyweight: false, extra: "No straps" });
    expect(parseNumberList(160).values).toEqual([160]);
  });

  it("undoes Google Sheets turning reps into dates", () => {
    expect(decodeDate(new Date(Date.UTC(2026, 8, 9)))).toEqual([9, 9]); // "9/9"
    expect(decodeDate(new Date(Date.UTC(2007, 7, 7)))).toEqual([8, 7, 7]); // "8/7/7"
    expect(parseNumberList(new Date(Date.UTC(2010, 9, 10))).values).toEqual([10, 10, 10]);
  });

  it("lines up weights with sets", () => {
    expect(alignSets(parseNumberList("135"), parseNumberList("8/8/7"))).toEqual([
      { weight: 135, reps: 8 },
      { weight: 135, reps: 8 },
      { weight: 135, reps: 7 },
    ]);
    expect(alignSets(parseNumberList("Body Weight"), parseNumberList("12/12"))[0]).toEqual({ weight: null, reps: 12 });
  });

  it("reads done / skipped", () => {
    expect(parseDone("Done")).toBe(true);
    expect(parseDone("done ")).toBe(true);
    expect(parseDone("Skipped")).toBe(false);
    expect(parseDone("na")).toBe(false);
    expect(parseDone("45 Min Walk")).toBeNull();
  });
});

/** Builds a sparse grid from { "C3": value } using 1-based A1 references. */
function grid(cells: Record<string, CellValue>): Grid {
  const rows: CellValue[][] = [];
  for (const [ref, value] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = Number(m[2]) - 1;
    (rows[row] ??= [])[col] = value;
  }
  for (let r = 0; r < rows.length; r++) rows[r] ??= [];
  return new Grid(rows.map((r) => Array.from(r, (v) => v ?? null)));
}

describe("MonthGridImporter", () => {
  // Two months side by side, like the real tab: "Feb" has no WEEK headers, "March" does.
  const sheet = grid({
    B1: "Feb", U1: "March", V1: "WEEK 1", Z1: "WEEK 2",
    C3: "Upper 1", G3: "Upper 1", V3: "Upper 1", Z3: "Upper 1",
    C4: "pulldown (2)", D4: "160", E4: "10/10",
    G4: "pulldown", H4: "160", I4: new Date(Date.UTC(2026, 7, 8)), // "8/8" typed in 2026
    V4: "pulldown", W4: "165", X4: "7/7",
    Z4: "pulldown", AA4: "165", AB4: "7/7", // copy of the week before
    C5: "single tricep", D5: "20", E5: "7/7",
    G5: "single tricep", H5: "20",
    V5: "bicep curl", W5: "40", X5: "7/7",
    Z5: "bicep curl", AA5: "40", AB5: "7/7",
    C7: "ABS/Cardio", V7: "ABS/Cardio",
    C8: "Cardio 1", D8: "45 Min Walk", E8: "Done",
    C9: "Leg Raises", D9: "Body Weight", E9: "12/12/12",
    C10: "Cardio 2", D10: "45 Min Walk", E10: "Skipped",
    C11: "Leg Raises", D11: "Body Weight", E11: "12/12",
    V8: "Cardio 1", V9: "Leg Raises",
  });
  const importer = new MonthGridImporter();

  it("detects workout days and guesses options", () => {
    expect(importer.canRead(sheet)).toBe(true);
    expect(importer.detectDays(sheet)).toEqual(["Upper 1", "ABS/Cardio"]);
    const options = importer.suggestOptions(sheet);
    expect(options.startYear).toBe(2026);
    expect(options.weekdays).toEqual({ "Upper 1": [0], "ABS/Cardio": [] });
  });

  it("turns weeks into dated sessions", () => {
    const plan = importer.read(sheet, importer.suggestOptions(sheet), "test.xlsx");
    const upper = plan.days.find((d) => d.name === "Upper 1")!;
    // Feb 2026 week 1 starts Monday Feb 2; March week 1 starts Monday Mar 2.
    expect(upper.sessions.map((s) => s.date)).toEqual(["2026-02-02", "2026-02-09", "2026-03-02"]);
    expect(plan.skippedCopies).toBe(1); // March week 2 matched week 1 exactly
    expect(upper.sessions[1]!.logs.find((l) => l.key === "pulldown")!.sets).toEqual([
      { weight: 160, reps: 8 },
      { weight: 160, reps: 8 },
    ]);
    // Latest week decides what's active; the target sets come from "(2)".
    expect(upper.exercises.map((e) => [e.name, e.active, e.targetSets])).toEqual([
      ["pulldown", true, 2],
      ["bicep curl", true, null],
      ["single tricep", false, null],
    ]);
  });

  it("splits Abs/Cardio into one session per cardio row, on rest days", () => {
    const plan = importer.read(sheet, importer.suggestOptions(sheet), "test.xlsx");
    const abs = plan.days.find((d) => d.name === "ABS/Cardio")!;
    // Rest days with Upper 1 on Monday: Tue, Wed, …  → first group Tue, second Wed.
    expect(abs.sessions.map((s) => s.date)).toEqual(["2026-02-03", "2026-02-04"]);
    expect(abs.sessions[0]!.logs[0]).toMatchObject({ key: "cardio", done: true });
    expect(abs.sessions[1]!.logs[0]).toMatchObject({ key: "cardio", done: false });
    expect(abs.exercises[0]).toMatchObject({ name: "Cardio", kind: "check", targetText: "45 Min Walk" });
  });
});
