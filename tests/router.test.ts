import { describe, expect, it } from "vitest";
import { href, parseHash, type Route } from "../src/ui/router";

describe("router", () => {
  it("round-trips every route through its hash", () => {
    const routes: Route[] = [
      { name: "home" },
      { name: "session", dayId: "a b/c", date: "2026-11-17" },
      { name: "day", date: "2026-11-18" },
      { name: "calendar", year: 2025 },
      { name: "calendar", year: null },
      { name: "progress", dayId: "x" },
      { name: "progress", dayId: null },
      { name: "setup" },
      { name: "setup", dayId: "lower" },
      { name: "settings" },
      { name: "import" },
    ];
    for (const route of routes) expect(parseHash(href(route))).toEqual(route);
  });

  it("falls back safely on odd hashes", () => {
    expect(parseHash("#/calendar/abc")).toEqual({ name: "calendar", year: null });
    expect(parseHash("#/session/only-day")).toEqual({ name: "home" });
    expect(parseHash("#/day")).toEqual({ name: "home" });
    expect(parseHash("#/session/%E0%A4%A/2026-01-01")).toEqual({ name: "session", dayId: "%E0%A4%A", date: "2026-01-01" });
    expect(parseHash("")).toEqual({ name: "home" });
  });
});
