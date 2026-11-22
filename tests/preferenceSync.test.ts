import { describe, expect, it } from "vitest";
import { readPreferences, reconcilePreferences } from "../src/data/preferenceSync";
import { EPOCH } from "../src/domain/ids";

const snap = (theme: string, updatedAt: string) => ({ values: { theme, showLastSession: true }, updatedAt });

describe("preference sync", () => {
  it("keeps the newest change", () => {
    expect(reconcilePreferences(snap("oled", "2026-11-21T10:00:00Z"), snap("graphite", "2026-11-21T11:00:00Z"))).toBe("adopt");
    expect(reconcilePreferences(snap("graphite", "2026-11-21T12:00:00Z"), snap("oled", "2026-11-21T11:00:00Z"))).toBe("push");
  });

  it("uploads a real choice when the account has none, but never untouched defaults", () => {
    expect(reconcilePreferences(snap("graphite", "2026-11-21T12:00:00Z"), null)).toBe("push");
    expect(reconcilePreferences(snap("oled", EPOCH), null)).toBe("none");
  });

  it("settles ties on the account's copy and does nothing when already equal", () => {
    const old = "1970-01-01T00:00:00.001Z";
    expect(reconcilePreferences(snap("oled", old), snap("graphite", old))).toBe("adopt");
    expect(reconcilePreferences(snap("oled", old), snap("oled", old))).toBe("none");
    expect(reconcilePreferences(snap("oled", EPOCH), snap("graphite", old))).toBe("adopt");
  });

  it("reads only well-formed snapshots from the account", () => {
    expect(readPreferences({ values: { theme: "oled" }, updatedAt: "2026-11-21T10:00:00Z" })).not.toBeNull();
    expect(readPreferences(undefined)).toBeNull();
    expect(readPreferences({ values: ["oled"], updatedAt: "2026-11-21T10:00:00Z" })).toBeNull();
    expect(readPreferences({ values: {}, updatedAt: "not a date" })).toBeNull();
    expect(readPreferences("oled")).toBeNull();
  });
});
