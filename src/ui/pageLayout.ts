import type { Route } from "./router";

/** The five places in the tab bar (phone) and the rail (computer). */
export type TabName = "home" | "calendar" | "progress" | "social" | "settings";

/** Which tab a route belongs to: a workout or rest day lives under Home, Workout Days and Import under Settings. */
export function tabOf(route: Route): TabName {
  switch (route.name) {
    case "home":
    case "session":
    case "day":
      return "home";
    case "calendar":
      return "calendar";
    case "progress":
      return "progress";
    case "social":
      return "social";
    case "settings":
    case "setup":
    case "import":
      return "settings";
  }
}

/**
 * The page a route shows, for the page-switch animation, the centering, and the column width.
 * A workout and the rest days around it are one page: stepping between them (‹ ›, Last / Next
 * session, a swipe) slides the content below the header instead of switching pages, and the page
 * holds its place, so the arrows stay under your finger.
 */
export type PageName = "home" | "workout" | "calendar" | "progress" | "social" | "settings" | "setup" | "import";

export function pageOf(route: Route): PageName {
  return route.name === "session" || route.name === "day" ? "workout" : route.name;
}

/**
 * Returns a function that is true from `poke()` until `ms` after the last poke, and tells
 * `onChange` when that flips. Used to hold the page still while you step through days.
 */
export function holdWindow(
  ms: number,
  onChange: (held: boolean) => void,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, wait) => setTimeout(fn, wait),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): { poke: () => void; dispose: () => void } {
  let timer: unknown = null;
  return {
    poke() {
      if (timer === null) onChange(true);
      else timers.clear(timer);
      timer = timers.set(() => {
        timer = null;
        onChange(false);
      }, ms);
    },
    dispose() {
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
}
