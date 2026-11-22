import { describe, expect, it } from "vitest";
import { outranks, sameContent, settle } from "../src/data/recordSync";
import type { Syncable } from "../src/domain/ids";

type Row = Syncable & Record<string, unknown>;
const T1 = "2026-11-18T08:00:00.001Z";
const T2 = "2026-11-18T08:00:00.002Z";
const copy = (updatedAt: string, logs: unknown[], extra: Record<string, unknown> = {}): Row => ({
  id: "s1",
  workoutDayId: "lower",
  date: "2026-11-18",
  logs,
  updatedAt,
  deleted: false,
  ...extra,
});
const set = (weight: number | null, reps: number | null) => ({ weight, reps });
const log = (exerciseId: string, sets: unknown[], note = "") => ({ exerciseId, sets, done: null, note });
/** The late Legpress log filed under Leg Press, and the same copy with it dropped. */
const filed = [log("press", [set(300, 10), set(320, 10)])];
const dropped = [log("press", [set(300, 10)])];

describe("settle", () => {
  it("takes a record this device doesn't have, and the newer of two copies", () => {
    expect(settle(copy(T1, filed), undefined, false)).toBe("take");
    expect(settle(copy(T2, dropped), copy(T1, filed), false)).toBe("take");
    expect(settle(copy(T1, filed), copy(T2, dropped), false)).toBe("keep");
    // Even when the newer copy holds less, or this device's copy waits to upload: newer wins.
    expect(settle(copy(T2, dropped), copy(T1, filed), true)).toBe("take");
  });

  it("settles two different copies with one stamp the same way on both devices", () => {
    // Two devices repaired the same late copy differently: one filed the log, one dropped it.
    expect(settle(copy(T1, filed), copy(T1, dropped), false)).toBe("take");
    // The device holding the filed copy keeps it and uploads it again, whichever reached the server last.
    expect(settle(copy(T1, dropped), copy(T1, filed), false)).toBe("push");
    // Already waiting to upload: it goes up anyway.
    expect(settle(copy(T1, dropped), copy(T1, filed), true)).toBe("keep");
  });

  it("ignores its own upload coming back, whatever the server did to key order and stamp format", () => {
    const local = copy(T1, filed);
    const echo: Row = {
      deleted: false,
      logs: [{ note: "", done: null, sets: [{ reps: 10, weight: 300 }, { reps: 10, weight: 320 }], exerciseId: "press" }],
      date: "2026-11-18",
      id: "s1",
      workoutDayId: "lower",
      updatedAt: "2026-11-18T08:00:00.001+00:00",
    };
    expect(sameContent(echo, local)).toBe(true);
    expect(settle(echo, local, false)).toBe("keep");
  });

  it("keeps the local copy when a stamp can't be read", () => {
    expect(settle(copy("not a time", filed), copy(T1, dropped), false)).toBe("keep");
  });
});

describe("outranks", () => {
  it("prefers the copy that kept more of what was logged", () => {
    expect(outranks(copy(T1, filed), copy(T1, dropped))).toBe(true);
    expect(outranks(copy(T1, dropped), copy(T1, filed))).toBe(false);
    // A deleted copy (its last log dropped) loses to any kept one.
    expect(outranks(copy(T1, [], { deleted: true }), copy(T1, []))).toBe(false);
    expect(outranks(copy(T1, []), copy(T1, filed, { deleted: true }))).toBe(true);
    // Done / skipped answers count like sets: filing a late check beats dropping it.
    const squat = log("squat", [set(225, 5)]);
    const answered = (done: boolean) => ({ exerciseId: "treadmill", sets: [], done, note: "" });
    expect(outranks(copy(T1, [squat, answered(true)]), copy(T1, [squat]))).toBe(true);
    expect(outranks(copy(T1, [squat]), copy(T1, [squat, answered(false)]))).toBe(false);
    // Same sets: the longer notes win (both notes kept beat one).
    const withNotes = [log("press", [set(300, 10)], "seat 4\nsled first")];
    const oneNote = [log("press", [set(300, 10)], "seat 4")];
    expect(outranks(copy(T1, withNotes), copy(T1, oneNote))).toBe(true);
  });

  it("orders any two different copies one way, whichever is asked first", () => {
    const a = copy(T1, [log("press", [set(300, 10)])]);
    const b = copy(T1, [log("squat", [set(300, 10)])]);
    expect(outranks(a, b)).not.toBe(outranks(b, a));
    expect(outranks(a, a)).toBe(false);
  });

  it("tells copies apart by any field, including the order of sets", () => {
    const swapped = [log("press", [set(320, 10), set(300, 10)])];
    expect(sameContent(copy(T1, filed), copy(T1, swapped))).toBe(false);
    expect(sameContent(copy(T1, filed), copy(T1, filed, { deleted: true }))).toBe(false);
    expect(sameContent(copy(T1, filed), copy(T1, filed, { note: undefined }))).toBe(true); // missing = undefined
  });
});
