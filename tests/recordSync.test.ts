import { describe, expect, it } from "vitest";
import { sameContent, takesRemote } from "../src/data/recordSync";
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
const filed = [{ exerciseId: "press", sets: [{ weight: 300, reps: 10 }, { weight: 320, reps: 10 }], done: null, note: "" }];
const dropped = [{ exerciseId: "press", sets: [{ weight: 300, reps: 10 }], done: null, note: "" }];

describe("takesRemote", () => {
  it("takes a record this device doesn't have, and the newer of two copies", () => {
    expect(takesRemote(copy(T1, filed), undefined, false)).toBe(true);
    expect(takesRemote(copy(T2, filed), copy(T1, dropped), false)).toBe(true);
    expect(takesRemote(copy(T1, filed), copy(T2, dropped), false)).toBe(false);
    // Even while this device's copy waits to upload: the newer edit wins either way.
    expect(takesRemote(copy(T2, filed), copy(T1, dropped), true)).toBe(true);
  });

  it("settles two different copies with one stamp on the server's", () => {
    // Two devices repaired the same late copy differently; the server holds the last one uploaded.
    expect(takesRemote(copy(T1, filed), copy(T1, dropped), false)).toBe(true);
    // This device's own repair goes up next instead, and the others take it then.
    expect(takesRemote(copy(T1, filed), copy(T1, dropped), true)).toBe(false);
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
    expect(takesRemote(echo, local, false)).toBe(false);
  });

  it("tells copies apart by any field, including the order of sets", () => {
    const twoSets = filed[0]!.sets;
    const swapped = [{ ...filed[0]!, sets: [twoSets[1], twoSets[0]] }];
    expect(sameContent(copy(T1, filed), copy(T1, swapped))).toBe(false);
    expect(sameContent(copy(T1, filed), copy(T1, filed, { deleted: true }))).toBe(false);
    expect(sameContent(copy(T1, filed), copy(T1, filed, { note: undefined }))).toBe(true); // missing = undefined
  });

  it("keeps the local copy when a stamp can't be read", () => {
    expect(takesRemote(copy("not a time", filed), copy(T1, dropped), false)).toBe(false);
  });
});
