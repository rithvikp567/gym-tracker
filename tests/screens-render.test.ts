import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { NoSync } from "../src/data/NoSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { LocalDate } from "../src/domain/LocalDate";
import { SetEntry } from "../src/domain/SetEntry";
import { BackupService } from "../src/services/BackupService";
import { CalendarService } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { SettingsService } from "../src/services/SettingsService";
import { SetupService } from "../src/services/SetupService";
import type { SyncController, SyncState } from "../src/services/ports";
import { HOME_PICK_KEY, homePick, homeWeek, weekRangeLabel } from "../src/ui/homePick";
import { setViewState } from "../src/ui/hooks/useViewState";
import { DayScreen } from "../src/ui/screens/DayScreen";
import { HomeScreen } from "../src/ui/screens/HomeScreen";
import { SessionScreen } from "../src/ui/screens/session/SessionScreen";
import { SetupScreen } from "../src/ui/screens/SetupScreen";
import { prefetchLive, ServicesProvider } from "../src/ui/ServicesContext";

/*
 * Screens rendered once on the server: no effects run, so no screen loads anything itself and
 * the first render shows only what the cache holds, just as a screen's first frame does when
 * you come back to it. Data is cached ahead with `prefetchLive`, under the screens' own keys.
 */

const d = (iso: string) => LocalDate.parse(iso);

function makeServices(now = new Date(2026, 10, 20, 12), options: { mode?: AppServices["mode"]; sync?: SyncState } = {}): AppServices {
  const clock = { now: () => now };
  const repos = new StoreRepositories(new MemoryRecordStore(), clock);
  const prefs = new Map<string, string>();
  return {
    mode: options.mode ?? "device",
    changes: repos.changes,
    setup: new SetupService(repos),
    sessions: new SessionService(repos),
    calendar: new CalendarService(repos, clock),
    progress: new ProgressService(repos, clock),
    imports: new ImportService(repos),
    backup: new BackupService(repos),
    settings: new SettingsService({ get: (k) => prefs.get(k) ?? null, set: (k, v) => void prefs.set(k, v) }, clock),
    sync: options.sync ? syncIn(options.sync) : new NoSync(),
  };
}

/** Sync that is set up, frozen in one state. */
function syncIn(state: SyncState): SyncController {
  const sync = new NoSync();
  return Object.assign(sync, { configured: true, status: () => ({ state, email: null, lastSyncedAt: null, message: null }) });
}

/** The screen's HTML, without the markers React puts between adjacent text parts. */
function render<P extends object>(services: AppServices, screen: FunctionComponent<P>, props: P): string {
  return renderToString(createElement(ServicesProvider, { services, children: createElement(screen, props) })).replaceAll("<!-- -->", "");
}

const home = (services: AppServices) => render(services, HomeScreen, {});
const cacheDays = (s: AppServices) => prefetchLive(s, "days", [], () => s.setup.days());

/** The same load as SessionScreen's, under its key. */
const cacheSession = (s: AppServices, dayId: string, date: LocalDate) =>
  prefetchLive(s, "session", [dayId, date.toString()], async () => {
    const [session, prev, next, last] = await Promise.all([
      s.sessions.open(dayId, date),
      s.sessions.previous(dayId, date),
      s.sessions.next(dayId, date),
      s.sessions.lastResultsBefore(dayId, date),
    ]);
    return { session, prev, next, last };
  });

/** The same load as DayScreen's, under its key. */
const cacheDay = (s: AppServices, date: LocalDate) =>
  prefetchLive(s, "day", [date.toString(), s.calendar.today().toString()], async () => {
    const [range, lastDone] = await Promise.all([s.calendar.range(date, date), s.sessions.lastWorkoutDates(s.calendar.today())]);
    return { info: range[0]!, lastDone };
  });

async function upperAndLower(s: AppServices) {
  let upper = await s.setup.createDay("Upper 1");
  upper = (await s.setup.updateDay(upper.id, (x) => x.addExercise("Pulldown")))!;
  const lower = await s.setup.createDay("Lower");
  await s.setup.setPlanned(0, upper.id); // Mondays
  return { upper, lower, pulldown: upper.activeExercises()[0]! };
}

const count = (html: string, text: string) => html.split(text).length - 1;

beforeEach(() => setViewState(HOME_PICK_KEY, null));

describe("Home", () => {
  it("draws the header, the arrows and all seven days of a week that hasn't loaded yet", async () => {
    const s = makeServices();
    const { upper } = await upperAndLower(s);
    await cacheDays(s);
    setViewState(HOME_PICK_KEY, homePick(d("2026-11-06"), s.calendar.today())); // never loaded

    const html = home(s);
    expect(html).not.toContain("Loading");
    expect(html).toContain("2 Weeks Ago");
    expect(html).toContain("Nov 2 – 8");
    expect(html).toContain("| Week 45");
    expect(html).toContain('aria-label="Previous week"');
    expect(count(html, 'class="week-day')).toBe(7);
    for (const n of [2, 3, 4, 5, 6, 7, 8]) expect(html).toContain(`<span class="dn num">${n}</span>`);
    // The rows are there (for the picked date), marked as still loading.
    expect(html).toContain(`href="#/session/${upper.id}/2026-11-06"`);
    expect(html).toMatch(/class="list" aria-busy="true"/);
  });

  it("draws a week loaded ahead (the one next to it) with its plan and dots at once", async () => {
    const s = makeServices();
    const { upper, pulldown } = await upperAndLower(s);
    await s.sessions.saveLog(upper.id, d("2026-11-09"), ExerciseLog.empty(pulldown.id).withSets([new SetEntry(100, 8)]));
    await cacheDays(s);
    const today = s.calendar.today();
    const lastWeek = homeWeek(s.calendar, d("2026-11-09"), today);
    await prefetchLive(s, lastWeek.cacheAs, lastWeek.deps, lastWeek.load);
    setViewState(HOME_PICK_KEY, homePick(d("2026-11-13"), today));

    const html = home(s);
    expect(html).toContain("Last Week");
    expect(html).toContain('<span class="plan">U1</span>');
    expect(html).toContain("Mon, Nov 9, worked out");
    expect(html).not.toMatch(/class="week-strip"[^>]*aria-busy/);
  });

  it("offers first-run setup only when 'no days yet' is fresh, not from an older copy", async () => {
    const s = makeServices();
    await cacheDays(s); // cached while there were no days
    expect(home(s)).toContain("set up your week");

    await s.setup.createDay("Upper 1"); // a change: the cached [] may be out of date now
    const html = home(s);
    expect(html).not.toContain("set up your week");
    expect(html).toContain("This Week");
  });

  it("keeps the sync chip's space while sync is set up but quiet", async () => {
    const placeholder = 'class="chip is-placeholder" aria-hidden="true"';
    const homeWith = async (options: Parameters<typeof makeServices>[1]) => {
      const s = makeServices(undefined, options);
      await upperAndLower(s);
      await cacheDays(s);
      return home(s);
    };
    // Signed in, but sign-in hasn't finished yet (or signed out): the space is kept.
    expect(await homeWith({ sync: "signed-out" })).toContain(placeholder);
    const synced = await homeWith({ sync: "idle" });
    expect(synced).toContain("Synced");
    expect(synced).not.toContain(placeholder);
    // No sync on this site: no chip and no space for one.
    expect(await homeWith({})).not.toContain('class="chip');
    expect(await homeWith({ mode: "demo" })).toContain("Demo data");
  });

  it("puts the week's title between its arrows on the week tile, and offers Today only away from today", async () => {
    const s = makeServices();
    await upperAndLower(s);
    await cacheDays(s);
    const html = home(s);
    expect(html).toMatch(/class="tile week-tile"[\s\S]*aria-label="Previous week"[\s\S]*<h1>This Week<\/h1>[\s\S]*aria-label="Next week"[\s\S]*class="week-strip"/);
    expect(html).not.toContain(">Today</button>");

    setViewState(HOME_PICK_KEY, homePick(d("2026-11-18"), s.calendar.today()));
    expect(home(s)).toContain(">Today</button>");
  });

  it("puts each year on its own end of a week that spans New Year", async () => {
    const s = makeServices(new Date(2026, 11, 31, 12)); // Thu Dec 31, 2026
    await upperAndLower(s);
    await cacheDays(s);
    const html = home(s);
    expect(html).toContain("Dec 28, 2026 – Jan 3, 2027");
    expect(html).toContain("| Week 53");
  });
});

describe("week range label", () => {
  const today = d("2026-11-20");
  it("leaves out this year", () => {
    expect(weekRangeLabel(d("2026-11-16"), today)).toBe("Nov 16 – 22");
    expect(weekRangeLabel(d("2026-11-30"), today)).toBe("Nov 30 – Dec 6");
  });

  it("adds another year once, after the end date", () => {
    expect(weekRangeLabel(d("2025-12-01"), today)).toBe("Dec 1 – 7, 2025");
    expect(weekRangeLabel(d("2027-03-29"), today)).toBe("Mar 29 – Apr 4, 2027");
  });

  it("names both years when the week spans New Year", () => {
    expect(weekRangeLabel(d("2026-12-28"), today)).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(weekRangeLabel(d("2026-12-28"), d("2027-01-01"))).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(weekRangeLabel(d("2025-12-29"), today)).toBe("Dec 29, 2025 – Jan 4, 2026");
  });
});

describe("Session screen", () => {
  it("says a workout day is gone only when that's fresh news", async () => {
    const s = makeServices();
    await cacheDays(s); // from before "Push" was added
    const push = await s.setup.createDay("Push");
    const date = { dayId: push.id, date: "2026-11-20" };

    const stale = render(s, SessionScreen, date);
    expect(stale).not.toContain("exist anymore");
    expect(stale).toContain('class="session-head"');

    await cacheDays(s);
    const gone = render(s, SessionScreen, { dayId: "deleted-day", date: "2026-11-20" });
    expect(gone).toContain("exist anymore");
  });

  it("says a day has no exercises only when that's fresh news", async () => {
    const s = makeServices();
    const push = await s.setup.createDay("Push");
    await cacheDays(s);
    await cacheSession(s, push.id, d("2026-11-20"));
    expect(render(s, SessionScreen, { dayId: push.id, date: "2026-11-20" })).toContain("No exercises on Push yet");

    await s.setup.updateDay(push.id, (x) => x.addExercise("Bench")); // added in Setup, then back
    expect(render(s, SessionScreen, { dayId: push.id, date: "2026-11-20" })).not.toContain("No exercises on Push yet");
  });

  it("keeps the delete footer's space while nothing is logged, so the list doesn't jump when it appears", async () => {
    const s = makeServices();
    const { upper, pulldown } = await upperAndLower(s);
    const props = { dayId: upper.id, date: "2026-11-20" };
    await cacheDays(s);
    await cacheSession(s, upper.id, d("2026-11-20"));
    const empty = render(s, SessionScreen, props);
    expect(empty).toContain('<div class="session-foot is-hidden" aria-hidden="true"><button type="button" class="btn danger" disabled="">');

    await s.sessions.saveLog(upper.id, d("2026-11-20"), ExerciseLog.empty(pulldown.id).withSets([new SetEntry(100, 8)]));
    await cacheSession(s, upper.id, d("2026-11-20"));
    const logged = render(s, SessionScreen, props);
    expect(logged).toContain('<div class="session-foot"><button type="button" class="btn danger">');
  });
});

describe("Workout and rest-day headers", () => {
  it("centers the name, puts the date between the day arrows, and Last / Next session under them", async () => {
    const s = makeServices();
    const { upper } = await upperAndLower(s);
    await cacheDays(s);
    await cacheSession(s, upper.id, d("2026-11-20"));
    const html = render(s, SessionScreen, { dayId: upper.id, date: "2026-11-20" });
    expect(html).toMatch(/class="session-top"><a class="icon-btn"[^>]*aria-label="Back"[\s\S]*<h1 class="session-name">Upper 1<\/h1><\/div>/);
    expect(html).toMatch(/aria-label="Previous day"[\s\S]*Fri, Nov 20 \| Week 47[\s\S]*aria-label="Next day"[\s\S]*class="session-jumps"/);
  });

  it("gives a rest day the same first two lines, so the arrows stay in place between days", async () => {
    const s = makeServices();
    await upperAndLower(s);
    await cacheDays(s);
    await cacheDay(s, d("2026-11-15"));
    const html = render(s, DayScreen, { date: "2026-11-15" });
    expect(html).toMatch(/class="session-top"><a class="icon-btn"[\s\S]*<h1 class="session-name">Rest day<\/h1><\/div>/);
    expect(html).toMatch(/aria-label="Previous day"[\s\S]*Sun, Nov 15 \| Week 46[\s\S]*aria-label="Next day"/);
    expect(html).not.toContain("session-jumps");
  });

  it("draws a workout's rows from the day before its session loads, so the centered page doesn't move when it lands", async () => {
    const s = makeServices();
    const { upper } = await upperAndLower(s);
    await cacheDays(s); // the session itself isn't cached
    const html = render(s, SessionScreen, { dayId: upper.id, date: "2026-11-20" });
    expect(html).toContain('<span class="label" role="button" tabindex="0" aria-expanded="false">Pulldown</span>');
    expect(html).toContain('class="session-foot is-hidden"');
  });

  it("draws a rest day's rows from your workout days before the day loads", async () => {
    const s = makeServices();
    const { upper } = await upperAndLower(s);
    await cacheDays(s);
    const html = render(s, DayScreen, { date: "2026-11-15" });
    expect(html).toContain(`href="#/session/${upper.id}/2026-11-15"`);
    expect(html).toMatch(/class="list" aria-busy="true"/);
    expect(html).not.toContain("Rest day");
  });
});

describe("Day screen", () => {
  it("calls a day a rest day only when that's fresh news", async () => {
    const s = makeServices();
    const { lower } = await upperAndLower(s);
    const sunday = d("2026-11-15");
    await cacheDays(s);
    await cacheDay(s, sunday);
    expect(render(s, DayScreen, { date: "2026-11-15" })).toContain("Rest day");

    // Logged from this list, then back: the cached copy still says nothing was logged.
    await s.sessions.saveLog(lower.id, sunday, ExerciseLog.empty("x").withNote("stretching"));
    const html = render(s, DayScreen, { date: "2026-11-15" });
    expect(html).not.toContain("Rest day");
    expect(html).not.toContain("Nothing planned");
  });
});

describe("Workout Days", () => {
  /** The same load as SetupScreen's, under its key. */
  const cacheSetup = (s: AppServices) => prefetchLive(s, "setup", [], async () => ({ days: await s.setup.days(), split: await s.setup.split() }));

  it("moves and deletes days by gesture: no Move up, Move down or Delete day in an open card", async () => {
    const s = makeServices();
    const { upper } = await upperAndLower(s);
    await cacheSetup(s);
    const html = render(s, SetupScreen, { openDayId: upper.id });
    expect(html).toContain("Pulldown"); // the card is open
    expect(html).not.toContain("Move up");
    expect(html).not.toContain("Move down");
    expect(html).not.toContain("Delete day");
    // Each day sits in a slot over its own Delete, which is out of reach until swiped to.
    expect(count(html, 'class="day-slot"')).toBe(2);
    expect(html).toMatch(/<button[^>]*class="day-delete"[^>]*inert=""[^>]*aria-label="Delete Upper 1"/);
    expect(html).toMatch(/<button[^>]*class="day-delete"[^>]*inert=""[^>]*aria-label="Delete Lower"/);
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"');
  });

  it("gives each exercise a handle on the left and Remove right of its ⋮", async () => {
    const s = makeServices();
    const { upper } = await upperAndLower(s);
    await s.setup.updateDay(upper.id, (x) => x.addExercise("Triceps"));
    await cacheSetup(s);
    const html = render(s, SetupScreen, { openDayId: upper.id });
    const row = html.slice(html.indexOf('class="ex-edit with-grip"'));
    const order = ['aria-label="Move Pulldown"', 'aria-label="Exercise name"', 'aria-label="Pulldown sets"', 'aria-label="More for Pulldown"', 'aria-label="Remove Pulldown"'].map((a) =>
      row.indexOf(a),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('aria-label="Move Triceps"');
    expect(html).toContain('aria-label="Remove Triceps"');
    expect(count(html, 'class="icon-btn danger"')).toBe(2);
  });
});
