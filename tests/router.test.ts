import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * A tab's history and scrolling, just enough for the router's bookkeeping. Programmatic scrolls
 * don't report back: in a browser their scroll event comes later, or never when the page is
 * already there, so saved positions must not depend on them.
 */
async function startApp() {
  const win = Object.assign(new EventTarget(), {
    scrollY: 0,
    scrollTo(_x: number, y: number) {
      win.scrollY = y;
    },
  });
  const entries: { hash: string; state: unknown }[] = [{ hash: "#/", state: null }];
  let index = 0;
  const location = {
    get hash() {
      return entries[index]!.hash;
    },
    set hash(value: string) {
      entries.splice(index + 1); // a new entry drops the ones after the current one
      entries.push({ hash: value, state: null });
      index += 1;
      win.dispatchEvent(new Event("hashchange"));
    },
  };
  const history = {
    scrollRestoration: "auto",
    get state() {
      return entries[index]!.state;
    },
    replaceState(state: unknown, _title: string, url?: string) {
      entries[index] = { hash: url ?? entries[index]!.hash, state };
    },
    back() {
      index -= 1;
      win.dispatchEvent(new Event("hashchange"));
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", history);
  vi.stubGlobal("HashChangeEvent", class extends Event {});
  vi.stubGlobal("requestAnimationFrame", () => 0);

  vi.resetModules(); // fresh bookkeeping for each test
  const router = await import("../src/ui/router");
  router.startHistory();
  // App scrolls after each screen change has rendered.
  const rendered = () => router.applyPendingScroll();
  return {
    router,
    /** A link to another screen. */
    open(hash: string) {
      location.hash = hash;
      rendered();
    },
    back() {
      history.back();
      rendered();
    },
    /** Moving within a screen (day arrows, Last session): replaces the entry. */
    replace(route: Route) {
      router.navigate(route, { replace: true });
      rendered();
    },
    /** The user scrolls the page. */
    scroll(y: number) {
      win.scrollY = y;
      win.dispatchEvent(new Event("scroll"));
    },
    get scrollY() {
      return win.scrollY;
    },
  };
}

describe("history and scroll positions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts you back where you were scrolled when you go back", async () => {
    const app = await startApp();
    app.open("#/calendar");
    app.scroll(900);
    app.open("#/session/upper/2026-03-02");
    expect(app.scrollY).toBe(0);
    app.back();
    expect(app.scrollY).toBe(900);
    expect(app.router.canGoBack()).toBe(true);
  });

  it("doesn't hand a new screen the position of a screen it replaced in history", async () => {
    const app = await startApp(); // Home
    app.open("#/session/upper/2026-11-16"); // Upper 1, scrolled down
    app.scroll(600);
    app.back(); // Home, at the top
    expect(app.scrollY).toBe(0);
    app.open("#/session/lower/2026-11-17"); // Lower, in the entry Upper 1 had (already at the top)
    app.open("#/progress");
    app.back(); // Lower again: never scrolled
    expect(app.scrollY).toBe(0);
  });

  it("starts a screen that replaces another at the top, also when you come back to it", async () => {
    const app = await startApp();
    app.open("#/session/upper/2026-11-16");
    app.scroll(600);
    app.replace({ name: "session", dayId: "upper", date: "2026-11-17" }); // the › day arrow
    expect(app.scrollY).toBe(0);
    app.open("#/progress");
    app.back();
    expect(app.scrollY).toBe(0);
  });
});
