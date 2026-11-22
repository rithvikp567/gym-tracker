import { useEffect, useState } from "react";

/**
 * Hash routes (#/session/…): they work on GitHub Pages without server rewrites and inside
 * the installed app.
 */
export type Route =
  | { name: "home" }
  | { name: "session"; dayId: string; date: string }
  /** A date with no single workout to show (a rest day): pick one. */
  | { name: "day"; date: string }
  | { name: "calendar"; year: number | null }
  | { name: "progress"; dayId: string | null }
  /** `dayId` opens that day's card (e.g. "Edit" from Progress). */
  | { name: "setup"; dayId?: string }
  | { name: "settings" }
  | { name: "import" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(safeDecode);
  switch (parts[0]) {
    case "session":
      return parts[1] && parts[2] ? { name: "session", dayId: parts[1], date: parts[2] } : { name: "home" };
    case "day":
      return parts[1] ? { name: "day", date: parts[1] } : { name: "home" };
    case "calendar": {
      const year = Number(parts[1]);
      return { name: "calendar", year: parts[1] && Number.isInteger(year) ? year : null };
    }
    case "progress":
      return { name: "progress", dayId: parts[1] ?? null };
    case "setup":
      return parts[1] ? { name: "setup", dayId: parts[1] } : { name: "setup" };
    case "settings":
      return { name: "settings" };
    case "import":
      return { name: "import" };
    default:
      return { name: "home" };
  }
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "session":
      return `#/session/${encodeURIComponent(route.dayId)}/${route.date}`;
    case "day":
      return `#/day/${route.date}`;
    case "calendar":
      return route.year ? `#/calendar/${route.year}` : "#/calendar";
    case "progress":
      return route.dayId ? `#/progress/${encodeURIComponent(route.dayId)}` : "#/progress";
    case "setup":
      return route.dayId ? `#/setup/${encodeURIComponent(route.dayId)}` : "#/setup";
    default:
      return `#/${route.name}`;
  }
}

/*
 * History bookkeeping, so the in-app back arrow can return to the screen you came from
 * (Calendar → a day → back lands on Calendar) and put the scroll position back.
 *
 * Every entry this tab visits is stamped with its depth (0 = where the app was opened).
 * Back goes through the browser's history when there's an earlier entry, otherwise to a
 * fallback screen. Links are plain `<a href="#/…">`, so new entries are recognised in the
 * hashchange handler by having no stamp yet.
 */

interface EntryState {
  gtDepth?: number;
}

let depth = 0;
/** Set while `navigate(…, { replace })` dispatches its synthetic hashchange. */
let replacing = false;
/** Where to scroll once the next route has rendered (null = leave it). */
let pendingScroll: number | null = null;
const scrollByDepth = new Map<number, number>();

function stampedDepth(): number | undefined {
  const state = history.state as EntryState | null;
  return typeof state?.gtDepth === "number" ? state.gtDepth : undefined;
}

function stamp(value: number): void {
  const state = (history.state ?? {}) as EntryState;
  history.replaceState({ ...state, gtDepth: value }, "");
}

/** Call once before the first render. */
export function startHistory(): void {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const known = stampedDepth();
  depth = known ?? 0;
  if (known === undefined) stamp(depth);
  window.addEventListener("scroll", () => scrollByDepth.set(depth, window.scrollY), { passive: true });
  // Added before the first render, so it runs before `useRoute` shows the new screen.
  window.addEventListener("hashchange", onHashChange);
}

/**
 * Updates the bookkeeping for a hash change and decides where the new screen scrolls to.
 * Saved positions only come from scroll events, and scrolling a page that is already at the
 * top fires none, so positions of screens that are gone are dropped here, never left to be
 * overwritten.
 */
function onHashChange(): void {
  const known = stampedDepth();
  if (replacing) {
    // Another screen in the same entry: it starts at the top, and so does its saved position.
    stamp(depth);
    scrollByDepth.set(depth, 0);
    pendingScroll = 0;
  } else if (known === undefined) {
    // A link or `location.hash = …`: a new entry after the current one. The browser has dropped
    // the entries that were after it (Forward is gone), so forget their positions too.
    depth += 1;
    stamp(depth);
    for (const d of [...scrollByDepth.keys()]) if (d >= depth) scrollByDepth.delete(d);
    pendingScroll = 0;
  } else {
    // Back or forward to an entry visited before: restore where it was scrolled to.
    depth = known;
    pendingScroll = scrollByDepth.get(known) ?? 0;
  }
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const target = href(route);
  if (options.replace) {
    history.replaceState({ gtDepth: depth } satisfies EntryState, "", target);
    replacing = true;
    try {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } finally {
      replacing = false;
    }
  } else {
    location.hash = target;
  }
}

/** True when there's an earlier screen in this tab's history to go back to. */
export function canGoBack(): boolean {
  return depth > 0;
}

/** The screen you came from, or `fallback` when the app was opened right here (a link, a reload). */
export function goBack(fallback: Route): void {
  if (canGoBack()) history.back();
  else navigate(fallback, { replace: true });
}

/**
 * Scrolls to where the new screen should be. Lists that load from storage can still be
 * growing for a moment, so a restore keeps trying briefly until the page is tall enough,
 * and stops as soon as the user touches or scrolls.
 */
export function applyPendingScroll(): void {
  const y = pendingScroll;
  pendingScroll = null;
  if (y === null) return;
  window.scrollTo(0, y);
  if (y === 0) return;
  const started = performance.now();
  let cancelled = false;
  const cancel = () => (cancelled = true);
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  events.forEach((e) => window.addEventListener(e, cancel, { once: true, passive: true }));
  const retry = () => {
    if (cancelled || Math.abs(window.scrollY - y) < 2 || performance.now() - started > 1500) {
      events.forEach((e) => window.removeEventListener(e, cancel));
      return;
    }
    window.scrollTo(0, y);
    requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
}

/** The current route; the history bookkeeping for each change runs first (see `startHistory`). */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
