import { act, createElement, StrictMode, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { NoSync } from "../src/data/NoSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { Exercise } from "../src/domain/Exercise";
import { ExerciseLog } from "../src/domain/ExerciseLog";
import { LocalDate } from "../src/domain/LocalDate";
import { SetEntry } from "../src/domain/SetEntry";
import { BackupService } from "../src/services/BackupService";
import { CalendarService, type DayTarget } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { SettingsService } from "../src/services/SettingsService";
import { SetupService } from "../src/services/SetupService";
import { CenterPage, useHoldBriefly, usePageHold } from "../src/ui/components/CenterBlock";
import { Sheet } from "../src/ui/components/controls";
import { HOME_PICK_KEY, homePick, rememberHomeDay } from "../src/ui/homePick";
import { useDayStep } from "../src/ui/hooks/useDayStep";
import { useLookVersion } from "../src/ui/hooks/useLookVersion";
import { useSwipe } from "../src/ui/hooks/useSwipe";
import { setViewState } from "../src/ui/hooks/useViewState";
import { navigate } from "../src/ui/router";
import { HomeScreen } from "../src/ui/screens/HomeScreen";
import { SetupScreen } from "../src/ui/screens/SetupScreen";
import { ExerciseEditor } from "../src/ui/screens/session/ExerciseEditor";
import { ServicesProvider } from "../src/ui/ServicesContext";
import { slideNext } from "../src/ui/slide";

vi.mock("../src/ui/router", async (original) => ({ ...(await original<typeof import("../src/ui/router")>()), navigate: vi.fn() }));
vi.mock("../src/ui/homePick", async (original) => ({ ...(await original<typeof import("../src/ui/homePick")>()), rememberHomeDay: vi.fn() }));
vi.mock("../src/ui/slide", async (original) => ({ ...(await original<typeof import("../src/ui/slide")>()), slideNext: vi.fn() }));

/*
 * Screens and hooks mounted with react-dom, so their effects run (loads, loading ahead, timers,
 * listeners). Tests run in Node with no DOM library, so they render into a small stand-in for
 * the DOM: just what React needs to build and update elements, plus a way to fire an element's
 * own listeners (a swipe).
 */

const HTML = "http://www.w3.org/1999/xhtml";

class FakeNode {
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];

  constructor(
    readonly ownerDocument: FakeDocument | null,
    readonly nodeType: number,
    readonly nodeName: string,
  ) {}

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  appendChild<N extends FakeNode>(node: N): N {
    return this.insertBefore(node, null);
  }

  insertBefore<N extends FakeNode>(node: N, before: FakeNode | null): N {
    node.parentNode?.removeChild(node);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild<N extends FakeNode>(node: N): N {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }

  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join("");
  }

  set textContent(text: string) {
    for (const n of [...this.childNodes]) this.removeChild(n);
    if (text) this.appendChild(this.ownerDocument!.createTextNode(text));
  }
}

class FakeText extends FakeNode {
  constructor(
    doc: FakeDocument,
    public nodeValue: string,
  ) {
    super(doc, 3, "#text");
  }

  override get textContent(): string {
    return this.nodeValue;
  }

  override set textContent(text: string) {
    this.nodeValue = text;
  }
}

type Listener = (event: Record<string, unknown>) => void;
type ListenerOptions = boolean | { capture?: boolean } | undefined;
const isCapture = (options: ListenerOptions) => (typeof options === "boolean" ? options : !!options?.capture);

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = { setProperty() {}, removeProperty() {} };
  readonly listeners: { type: string; listener: Listener; capture: boolean }[] = [];

  constructor(
    doc: FakeDocument,
    readonly localName: string,
    readonly namespaceURI: string,
  ) {
    super(doc, 1, namespaceURI === HTML ? localName.toUpperCase() : localName);
    this.tagName = this.nodeName;
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    this.listeners.push({ type, listener, capture: isCapture(options) });
  }

  removeEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    const i = this.listeners.findIndex((l) => l.type === type && l.listener === listener && l.capture === isCapture(options));
    if (i >= 0) this.listeners.splice(i, 1);
  }

  closest(): null {
    return null;
  }

  scrollIntoView(): void {}

  /** A <select>'s choices (React picks the selected one through this). */
  get options(): FakeElement[] {
    return findAll(this, (el) => el.localName === "option");
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  /** Calls this element's own listeners for `type` (nothing bubbles). */
  fire(type: string, event: Record<string, unknown>): void {
    for (const l of this.listeners.filter((x) => x.type === type)) l.listener({ type, target: this, ...event });
  }
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  readonly activeElement = null;
  defaultView: unknown = null;

  constructor() {
    super(null, 9, "#document");
    this.documentElement = this.appendChild(this.createElement("html"));
    this.body = this.documentElement.appendChild(this.createElement("body"));
  }

  createElement(localName: string): FakeElement {
    return new FakeElement(this, localName, HTML);
  }

  createElementNS(namespace: string, localName: string): FakeElement {
    return new FakeElement(this, localName, namespace);
  }

  createTextNode(text: string): FakeText {
    return new FakeText(this, text);
  }

  getElementById(id: string): FakeElement | null {
    return findAll(this, (el) => el.getAttribute("id") === id)[0] ?? null;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

const doc = new FakeDocument();
const win = { document: doc, event: undefined, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} };
doc.defaultView = win;

let mounted: { root: Root; container: FakeElement } | null = null;

/** Renders `node` in StrictMode, as the app does, and runs its effects. */
function mount(node: ReactNode): FakeElement {
  const container = doc.body.appendChild(doc.createElement("div"));
  mounted = { root: createRoot(container as unknown as Element), container };
  rerender(node);
  return container;
}

function rerender(node: ReactNode): void {
  act(() => mounted!.root.render(createElement(StrictMode, null, node)));
}

function unmount(): void {
  if (!mounted) return;
  const { root, container } = mounted;
  mounted = null;
  act(() => root.unmount());
  doc.body.removeChild(container);
}

/** Waits `ms`, then lets the loads in flight land (the in-memory store answers at once) and renders what they bring. */
async function settle(ms = 0): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

/** A finger dragged `dx` px sideways across `el`. Synchronous: nothing in flight lands meanwhile. */
function swipe(el: FakeElement, dx: number): void {
  act(() => {
    el.fire("touchstart", { touches: [{ clientX: 200, clientY: 300 }] });
    el.fire("touchend", { changedTouches: [{ clientX: 200 + dx, clientY: 300 }] });
  });
}

function findAll(node: FakeNode, match: (el: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (n: FakeNode) => {
    if (n instanceof FakeElement && match(n)) found.push(n);
    n.childNodes.forEach(walk);
  };
  walk(node);
  return found;
}

const byClass = (node: FakeNode, name: string) => findAll(node, (el) => (el.getAttribute("class") ?? "").split(" ").includes(name));

function one(node: FakeNode, name: string): FakeElement {
  const [el] = byClass(node, name);
  if (!el) throw new Error(`No .${name} on screen`);
  return el;
}

beforeEach(() => {
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  setViewState(HOME_PICK_KEY, null);
});

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const d = (iso: string) => LocalDate.parse(iso);

/** Every service over an in-memory store, on Fri Nov 20, 2026. */
function makeServices(): AppServices {
  const clock = { now: () => new Date(2026, 10, 20, 12) }; // Fri Nov 20, 2026
  const repos = new StoreRepositories(new MemoryRecordStore(), clock);
  const prefs = new Map<string, string>();
  return {
    mode: "device",
    changes: repos.changes,
    setup: new SetupService(repos),
    sessions: new SessionService(repos),
    calendar: new CalendarService(repos, clock),
    progress: new ProgressService(repos, clock),
    imports: new ImportService(repos),
    backup: new BackupService(repos),
    settings: new SettingsService({ get: (k) => prefs.get(k) ?? null, set: (k, v) => void prefs.set(k, v) }, clock),
    sync: new NoSync(),
  };
}

/** The handlers React gave an element (to press it the way a tap would). */
function reactProps<T>(el: FakeElement): T {
  return Object.entries(el).find(([k]) => k.startsWith("__reactProps$"))![1] as T;
}

describe("Home, mounted", () => {

  /** Upper 1 planned on Mondays, logged Mon Nov 16 (this week); Lower logged Mon Nov 9 (last week). */
  async function mondays(s: AppServices) {
    let upper = await s.setup.createDay("Upper 1");
    upper = (await s.setup.updateDay(upper.id, (x) => x.addExercise("Pulldown")))!;
    const lower = await s.setup.createDay("Lower");
    await s.setup.setPlanned(0, upper.id);
    const log = ExerciseLog.empty(upper.activeExercises()[0]!.id).withSets([new SetEntry(100, 8)]);
    await s.sessions.saveLog(upper.id, d("2026-11-16"), log);
    await s.sessions.saveLog(lower.id, d("2026-11-09"), log);
  }

  /** Which weeks Home asks for; the week starting `hold` doesn't answer until `release()`. */
  function watchWeeks(s: AppServices, hold?: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const week = s.calendar.week.bind(s.calendar);
    const spy = vi.spyOn(s.calendar, "week").mockImplementation(async (anchor) => {
      if (anchor.toString() === hold) await gate;
      return week(anchor);
    });
    return { asked: () => [...new Set(spy.mock.calls.map(([anchor]) => anchor.toString()))].sort(), release };
  }

  /** Home on Monday Nov 16, everything loaded (nothing was cached before). */
  async function openHome(s: AppServices): Promise<FakeElement> {
    setViewState(HOME_PICK_KEY, homePick(d("2026-11-16"), s.calendar.today()));
    const home = mount(createElement(ServicesProvider, { services: s, children: createElement(HomeScreen) }));
    await settle();
    return home;
  }

  const title = (home: FakeElement) => findAll(home, (el) => el.localName === "h1")[0]?.textContent;
  const plans = (home: FakeElement) => byClass(home, "plan").map((el) => el.textContent);
  const busy = (el: FakeElement) => el.getAttribute("aria-busy") === "true";
  /** The rows with a check: the workouts logged on the picked date. */
  const logged = (home: FakeElement) =>
    byClass(home, "day-row")
      .filter((row) => byClass(row, "check-mark").length > 0)
      .map((row) => one(row, "title").firstChild?.textContent);

  it("loads the weeks either side of the one on screen, so each step draws at once", async () => {
    const s = makeServices();
    await mondays(s);
    const weeks = watchWeeks(s);
    const home = await openHome(s);
    expect(title(home)).toBe("This week");
    expect(logged(home)).toEqual(["Upper 1"]);
    expect(weeks.asked()).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);

    // Checked before anything in flight can land: the week was already there.
    swipe(one(home, "week-strip"), 100);
    expect(title(home)).toBe("Last week");
    expect(busy(one(home, "week-strip"))).toBe(false);
    expect(plans(home)).toEqual(["U1", "", "", "", "", "", ""]);
    expect(logged(home)).toEqual(["Lower"]);
    expect(busy(one(home, "list"))).toBe(false);

    // A week that came from the cache loads its own neighbours in turn.
    await settle();
    expect(weeks.asked()).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
    swipe(one(home, "week-strip"), 100);
    expect(title(home)).toBe("2 weeks ago");
    expect(busy(one(home, "week-strip"))).toBe(false);
    expect(plans(home)).toEqual(["U1", "", "", "", "", "", ""]);
    expect(logged(home)).toEqual([]);
    expect(busy(one(home, "list"))).toBe(false);
    await settle(); // its own reload
  });

  it("keeps the week last on screen in the rows, busy and then dimmed, while the next one loads", async () => {
    const s = makeServices();
    await mondays(s);
    const weeks = watchWeeks(s, "2026-11-02");
    const home = await openHome(s);

    // Two quick steps: the first week comes from the cache, the second isn't there yet.
    swipe(one(home, "week-strip"), 100);
    expect(logged(home)).toEqual(["Lower"]);
    swipe(one(home, "week-strip"), 100);
    expect(title(home)).toBe("2 weeks ago");
    expect(busy(one(home, "week-strip"))).toBe(true);
    expect(plans(home)).toEqual(["", "", "", "", "", "", ""]);
    // Last week's rows (the ones just shown), not this week's.
    expect(logged(home)).toEqual(["Lower"]);
    const rows = one(home, "list");
    expect(busy(rows)).toBe(true);
    expect(rows.getAttribute("data-stale")).toBeNull();

    await settle(200); // past the 150 ms before busy rows are dimmed
    expect(logged(home)).toEqual(["Lower"]);
    expect(one(home, "list").getAttribute("data-stale")).toBe("true");

    weeks.release();
    await settle();
    expect(busy(one(home, "week-strip"))).toBe(false);
    expect(plans(home)).toEqual(["U1", "", "", "", "", "", ""]);
    expect(logged(home)).toEqual([]);
    expect(busy(one(home, "list"))).toBe(false);
    expect(one(home, "list").getAttribute("data-stale")).toBeNull();
  });
});

describe("day arrows, mounted", () => {
  /** A calendar whose day lookup answers only when told to (it reads every session, so it can be slow). */
  function slowCalendar() {
    let answer!: (target: DayTarget) => void;
    const calendar = {
      today: () => d("2026-11-20"),
      dayTarget: vi.fn(() => new Promise<DayTarget>((resolve) => (answer = resolve))),
    };
    return { calendar, answer: (target: DayTarget) => answer(target) };
  }

  /** A workout screen's arrows (Tue Nov 17, Upper 1); returns its step function. */
  function mountArrows(calendar: ReturnType<typeof slowCalendar>["calendar"]): (delta: -1 | 1) => void {
    let step!: (delta: -1 | 1) => void;
    function Arrows() {
      step = useDayStep(d("2026-11-17"), "upper");
      return null;
    }
    const services = { calendar } as unknown as AppServices;
    mount(createElement(ServicesProvider, { services, children: createElement(Arrows) }));
    return (delta) => step(delta);
  }

  it("step once the lookup answers, StrictMode's remount included", async () => {
    const { calendar, answer } = slowCalendar();
    const step = mountArrows(calendar);
    step(1);
    answer({ kind: "workout", dayId: "lower" });
    await settle();
    expect(slideNext).toHaveBeenCalledWith("forward");
    expect(rememberHomeDay).toHaveBeenCalledWith(d("2026-11-18"), d("2026-11-20"));
    expect(navigate).toHaveBeenCalledWith({ name: "session", dayId: "lower", date: "2026-11-18" }, { replace: true });
  });

  it("take one step at a time", async () => {
    const { calendar, answer } = slowCalendar();
    const step = mountArrows(calendar);
    step(1);
    step(1);
    expect(calendar.dayTarget).toHaveBeenCalledTimes(1);
    answer({ kind: "pick" });
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
    step(-1); // the first one is done
    expect(calendar.dayTarget).toHaveBeenCalledTimes(2);
  });

  it("do nothing when the screen is gone by the time the lookup answers", async () => {
    const { calendar, answer } = slowCalendar();
    const step = mountArrows(calendar);
    step(-1);
    unmount(); // Back to Home (or Last session) while the lookup ran
    answer({ kind: "pick" });
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    expect(rememberHomeDay).not.toHaveBeenCalled();
    expect(slideNext).not.toHaveBeenCalled();
  });
});

describe("swipe, mounted", () => {
  function Swipeable({ ready, onSwipeLeft }: { ready: boolean; onSwipeLeft: () => void }) {
    const el = useRef<HTMLDivElement>(null);
    useSwipe(el, { onSwipeLeft });
    // Like a screen whose first render is a loading state.
    return ready ? createElement("div", { ref: el, className: "swipeable" }) : createElement("p", null, "Loading…");
  }

  it("binds to an element that only shows up on a later render, and lets go of it", () => {
    const first = vi.fn();
    const host = mount(createElement(Swipeable, { ready: false, onSwipeLeft: first }));
    rerender(createElement(Swipeable, { ready: true, onSwipeLeft: first }));
    const el = one(host, "swipeable");
    swipe(el, -100);
    expect(first).toHaveBeenCalledTimes(1);

    // The latest handler runs, and a short drag is no swipe.
    const second = vi.fn();
    rerender(createElement(Swipeable, { ready: true, onSwipeLeft: second }));
    swipe(el, -100);
    swipe(el, -30);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    rerender(createElement(Swipeable, { ready: false, onSwipeLeft: second }));
    expect(el.listeners).toEqual([]);
  });

  it("lets go of the element on unmount", () => {
    const host = mount(createElement(Swipeable, { ready: true, onSwipeLeft: vi.fn() }));
    const el = one(host, "swipeable");
    expect(el.listeners.map((l) => l.type).sort()).toEqual(["touchend", "touchstart"]);
    unmount();
    expect(el.listeners).toEqual([]);
  });
});

describe("centered page holds, mounted", () => {
  /** A screen with something that opens (a row) and a control that changes the page's height (a range). */
  function Screen({ open, onNudge }: { open: boolean; onNudge: (nudge: () => void) => void }) {
    usePageHold(open);
    onNudge(useHoldBriefly());
    return createElement("p", null, "Screen");
  }
  const page = (host: FakeElement) => one(host, "page");
  const held = (host: FakeElement) => byClass(host, "is-held").length > 0;

  it("holds while a screen has something open, and lets go when it closes", () => {
    const host = mount(createElement(CenterPage, { page: "workout", enter: false, children: createElement(Screen, { open: false, onNudge() {} }) }));
    expect(page(host).getAttribute("class")).toBe("center-block page");
    rerender(createElement(CenterPage, { page: "workout", enter: false, children: createElement(Screen, { open: true, onNudge() {} }) }));
    expect(held(host)).toBe(true);
    rerender(createElement(CenterPage, { page: "workout", enter: false, children: createElement(Screen, { open: false, onNudge() {} }) }));
    expect(held(host)).toBe(false);
  });

  it("holds for a moment after a nudge (a range or year switch), then re-centers", async () => {
    let nudge = () => {};
    const host = mount(
      createElement(CenterPage, {
        page: "progress",
        enter: true,
        children: createElement(Screen, { open: false, onNudge: (n) => (nudge = n) }),
      }),
    );
    expect(one(host, "page-content").getAttribute("class")).toBe("center-block-content page-content page-in");
    act(() => nudge());
    expect(held(host)).toBe(true);
    await settle(1300);
    expect(held(host)).toBe(false);
  });
});

describe("Workout Days holds, mounted", () => {
  const held = (host: FakeElement) => byClass(host, "is-held").length > 0;
  /** A tap on a day's card head (opens or closes it). */
  function tapDay(host: FakeElement, name: string): void {
    const head = byClass(host, "day-card-head").find((el) => one(el, "title").textContent === name);
    if (!head) throw new Error(`No card for ${name}`);
    act(() => reactProps<{ onClick: () => void }>(head).onClick());
  }

  it("doesn't hold for the day the route opened (it would keep the Loading… offset); holds once you tap, and lets go when the open day is deleted", async () => {
    const s = makeServices();
    const upper = await s.setup.createDay("Upper 1");
    const lower = await s.setup.createDay("Lower");
    // Progress → Edit on Upper 1, with nothing loaded yet: the page draws "Loading…" first.
    const host = mount(
      createElement(ServicesProvider, {
        services: s,
        children: createElement(CenterPage, { page: "setup", enter: false, children: createElement(SetupScreen, { openDayId: upper.id }) }),
      }),
    );
    expect(byClass(host, "loading")).toHaveLength(1);
    await settle();
    expect(byClass(host, "day-card")).toHaveLength(2);
    expect(byClass(host, "open")).toHaveLength(1);
    expect(held(host)).toBe(false);

    tapDay(host, "Upper 1"); // closes it: nothing open
    expect(held(host)).toBe(false);
    tapDay(host, "Lower");
    expect(held(host)).toBe(true);

    await act(() => s.setup.deleteDay(lower.id));
    await settle();
    expect(byClass(host, "day-card")).toHaveLength(1);
    expect(held(host)).toBe(false);
  });
});

describe("Sheet, mounted", () => {
  type BackdropProps = { onPointerDown: (e: unknown) => void; onClick: (e: unknown) => void };

  it("draws into <body>, outside the page that moves while it animates", () => {
    const host = mount(createElement(Sheet, { title: "Mon, Nov 16", onClose() {}, children: "Nothing logged." }));
    expect(byClass(host, "sheet-backdrop")).toHaveLength(0);
    const backdrop = one(doc.body, "sheet-backdrop");
    expect(backdrop.parentNode).toBe(doc.body);
    expect(one(backdrop, "sheet").textContent).toContain("Nothing logged.");
  });

  it("closes on a tap on the backdrop, not on a press that started inside and was let go outside", () => {
    const onClose = vi.fn();
    mount(createElement(Sheet, { title: "Mon, Nov 16", onClose, children: "Nothing logged." }));
    const backdrop = one(doc.body, "sheet-backdrop");
    const sheet = one(backdrop, "sheet");
    const press = (start: FakeElement, end: FakeElement) => {
      const props = reactProps<BackdropProps>(backdrop);
      act(() => {
        props.onPointerDown({ target: start, currentTarget: backdrop });
        props.onClick({ target: end, currentTarget: backdrop });
      });
    };

    press(sheet, backdrop); // e.g. selecting text past the sheet's edge
    expect(onClose).not.toHaveBeenCalled();
    press(backdrop, backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("look version, mounted", () => {
  it("changes when the look on <html> changes, so token colors read in code are read again", () => {
    let notify = () => {};
    const observed: { target: unknown; options: MutationObserverInit }[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe(target: unknown, options: MutationObserverInit) {
          observed.push({ target, options });
        }
        disconnect = disconnect;
      },
    );
    let version = -1;
    function Probe() {
      version = useLookVersion();
      return null;
    }
    mount(createElement(Probe));
    expect(version).toBe(0);
    expect(observed.at(-1)!.target).toBe(doc.documentElement);
    expect(observed.at(-1)!.options.attributeFilter).toEqual(expect.arrayContaining(["data-theme", "data-family", "style"]));

    act(() => notify()); // e.g. a dark → light theme synced in from another device
    expect(version).toBe(1);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("ExerciseEditor units, mounted", () => {
  /** What typing into an input does: calls its React change handler with the new value. */
  function type(el: FakeElement, value: string): void {
    const props = Object.entries(el).find(([k]) => k.startsWith("__reactProps$"))![1] as { onChange: (e: unknown) => void };
    act(() => props.onChange({ target: { value } }));
  }
  function field(host: FakeNode, label: string): FakeElement {
    const [el] = findAll(host, (e) => e.getAttribute("aria-label") === label);
    if (!el) throw new Error(`No field labelled ${label}`);
    return el;
  }
  const platesPress = () => Exercise.create("Leg press").withUnit("plates", "relabel");
  const lastSaved = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.lastCall![0] as ExerciseLog;

  it("logs a day that only has a note in the exercise's unit, whatever unit the note was saved in", async () => {
    const press = platesPress();
    const onSave = vi.fn();
    const note = ExerciseLog.empty(press.id).withNote("seat 4").withUnit("lb"); // saved by an editor working in pounds
    const host = mount(createElement(ExerciseEditor, { exercise: press, log: note, last: undefined, onSave }));
    expect(field(host, "Set 1 weight").getAttribute("placeholder")).toBe("plates");
    type(field(host, "Set 1 weight"), "2.5");
    await settle(450);
    const saved = lastSaved(onSave);
    expect([saved.unit, saved.topWeight(), saved.note]).toEqual(["plates", 2.5, "seat 4"]);
  });

  it("keeps a day's weights in their unit when the exercise is now done / not done", async () => {
    const press = Exercise.create("Leg press").withUnit("plates", "keep").with({ kind: "check" }); // unmarked logs: pounds
    const onSave = vi.fn();
    const log = ExerciseLog.empty(press.id).withSets([new SetEntry(2.5, 10)]).withUnit("plates");
    const host = mount(createElement(ExerciseEditor, { exercise: press, log, last: undefined, onSave }));
    const [done] = findAll(host, (el) => el.tagName === "BUTTON" && el.textContent.includes("Done"));
    const props = Object.entries(done!).find(([k]) => k.startsWith("__reactProps$"))![1] as { onClick: () => void };
    act(() => props.onClick());
    await settle(450);
    const saved = lastSaved(onSave);
    expect([saved.done, saved.unit, saved.topWeight()]).toEqual([true, "plates", 2.5]);
  });

  it("keeps the unit it opened in when a weight is cleared mid-edit", async () => {
    const press = platesPress();
    const onSave = vi.fn();
    const pounds = ExerciseLog.empty(press.id).withSets([new SetEntry(370, 10)]).withUnit("lb");
    const props = { exercise: press, last: undefined, onSave };
    const host = mount(createElement(ExerciseEditor, { ...props, log: pounds }));
    type(field(host, "Set 1 weight"), "");
    await settle(450);
    const cleared = lastSaved(onSave);
    expect([cleared.topWeight(), cleared.unit]).toEqual([null, undefined]);
    // The session reloads with that copy; the editor stays in pounds.
    rerender(createElement(ExerciseEditor, { ...props, log: cleared }));
    expect(field(host, "Set 1 weight").getAttribute("placeholder")).toBe("lb");
    type(field(host, "Set 1 weight"), "380");
    await settle(450);
    expect([lastSaved(onSave).unit, lastSaved(onSave).topWeight()]).toEqual(["lb", 380]);
  });
});
