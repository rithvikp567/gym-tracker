import { act, createElement, StrictMode, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { NoSync } from "../src/data/NoSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
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
import { HOME_PICK_KEY, homePick, rememberHomeDay } from "../src/ui/homePick";
import { useDayStep } from "../src/ui/hooks/useDayStep";
import { useSwipe } from "../src/ui/hooks/useSwipe";
import { setViewState } from "../src/ui/hooks/useViewState";
import { navigate } from "../src/ui/router";
import { HomeScreen } from "../src/ui/screens/HomeScreen";
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

describe("Home, mounted", () => {
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
