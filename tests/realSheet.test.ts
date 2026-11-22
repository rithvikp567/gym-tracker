/**
 * Runs the importer on your real export without committing it (it's git-ignored):
 *   GYM_SHEET="$HOME/Downloads/Gym Tracker.xlsx" npx vitest run tests/realSheet.test.ts
 */
import { describe, expect, it } from "vitest";
import { Grid } from "../src/importers/Grid";
import { MonthGridImporter } from "../src/importers/MonthGridImporter";

const path = process.env.GYM_SHEET;

describe.skipIf(!path)("real sheet import", () => {
  it("reads the Upper Lower tab", async () => {
    const { default: readXlsxFile } = await import("read-excel-file/node");
    const sheets = await readXlsxFile(path!);
    const tab = sheets.find((s) => s.sheet === "Upper Lower")!;
    const grid = new Grid(tab.data);
    const importer = new MonthGridImporter();
    const options = importer.suggestOptions(grid);
    const plan = importer.read(grid, options, "Gym Tracker.xlsx");

    console.log("options", JSON.stringify(options));
    for (const day of plan.days) {
      const dates = day.sessions.map((s) => s.date);
      console.log(
        `\n## ${day.name}: ${day.sessions.length} sessions ${dates[0]} → ${dates.at(-1)}\n  active: ${day.exercises
          .filter((e) => e.active)
          .map((e) => `${e.name}${e.targetSets ? ` (${e.targetSets})` : ""}${e.kind === "check" ? " [check: " + e.targetText + "]" : ""}`)
          .join(", ")}\n  archived: ${day.exercises.filter((e) => !e.active).map((e) => e.name).join(", ")}`,
      );
      for (const s of day.sessions.slice(0, 2).concat(day.sessions.slice(-1))) {
        console.log(`  ${s.date} (${s.label}): ${s.logs.map((l) => `${l.key}=${l.sets.map((x) => `${x.weight ?? "BW"}x${x.reps ?? "-"}`).join(",")}${l.done !== null ? ` done=${l.done}` : ""}${l.note ? ` [${l.note}]` : ""}`).join(" | ")}`);
      }
    }
    console.log("\nsplit", plan.split, "skippedCopies", plan.skippedCopies);
    console.log("warnings", plan.warnings.length, plan.warnings.slice(0, 12));
    expect(plan.days.length).toBeGreaterThan(0);
  });
});
