import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepFullHeight, opensKeyboard } from "../src/ui/viewport";

type Listener = (e: { target?: unknown }) => void;

/** Just enough of `window` and `document`: listeners, sizes, scroll, focus and display mode. */
function fakeWindow({ standalone = true } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const on = (type: string, fn: Listener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
  const off = (type: string, fn: Listener) => void listeners.get(type)?.delete(fn);
  const fire = (type: string, e: { target?: unknown } = {}) => listeners.get(type)?.forEach((fn) => fn(e));
  const doc = {
    activeElement: { tagName: "BODY" } as unknown,
    visibilityState: "visible",
    addEventListener: (t: string, fn: Listener) => on(`doc:${t}`, fn),
    removeEventListener: (t: string, fn: Listener) => off(`doc:${t}`, fn),
  };
  const win = {
    innerWidth: 393,
    innerHeight: 852,
    scrollX: 0,
    scrollY: 0,
    navigator: {},
    document: doc,
    matchMedia: (q: string) => ({ matches: standalone && q === "(display-mode: standalone)" }),
    addEventListener: on,
    removeEventListener: off,
    scrollTo: vi.fn((x: number, y: number) => Object.assign(win, { scrollX: x, scrollY: y })),
  };
  return { win, doc, fire, listeners };
}

/** The shell: records each display change, and the window gets its height back when it lays out hidden. */
function fakeShell(onLayout: () => void) {
  const displays: string[] = [];
  let display = "";
  const style = {
    get display() {
      return display;
    },
    set display(v: string) {
      display = v;
      displays.push(v);
    },
  };
  const el = {
    style,
    get offsetHeight() {
      if (display === "none") onLayout();
      return 0;
    },
  };
  return { el: el as unknown as HTMLElement, displays };
}

const input = { tagName: "INPUT", type: "text" };

describe("keepFullHeight (D57)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("knows what brings up the keyboard", () => {
    expect([input, { tagName: "INPUT", type: "number" }, { tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }].map(opensKeyboard)).toEqual([true, true, true, true, true, true]);
    expect([{ tagName: "INPUT", type: "checkbox" }, { tagName: "INPUT", type: "range" }, { tagName: "BUTTON" }, { tagName: "BODY" }, null, undefined].map(opensKeyboard)).toEqual([false, false, false, false, false, false]);
  });

  it("puts the window back to full height once the keyboard has gone, keeping the scroll", () => {
    const { win, doc, fire } = fakeWindow();
    const shell = fakeShell(() => (win.innerHeight = 852));
    const stop = keepFullHeight(win as unknown as Window, () => shell.el);
    win.scrollY = 420;

    // Typing: the keyboard is up and iOS made the window short.
    doc.activeElement = input;
    win.innerHeight = 793;
    fire("resize");
    // Done typing; iOS leaves the window short.
    doc.activeElement = { tagName: "BODY" };
    fire("doc:focusout", { target: input });
    expect(shell.displays).toEqual([]); // not until the keyboard has slid away
    vi.advanceTimersByTime(150);
    expect(shell.displays).toEqual(["none", ""]);
    expect(win.innerHeight).toBe(852);
    expect(win.scrollTo).toHaveBeenLastCalledWith(0, 420);
    vi.advanceTimersByTime(1000);
    expect(shell.displays).toEqual(["none", ""]); // the second look finds it whole
    stop();
  });

  it("leaves it alone while the focus moves to another field, when it isn't short, and in a Safari tab", () => {
    const { win, doc, fire } = fakeWindow();
    const shell = fakeShell(() => (win.innerHeight = 852));
    const stop = keepFullHeight(win as unknown as Window, () => shell.el);
    win.innerHeight = 793;
    doc.activeElement = { tagName: "INPUT", type: "number" }; // tapped the next set's reps
    fire("doc:focusout", { target: input });
    vi.advanceTimersByTime(1000);
    expect(shell.displays).toEqual([]);

    win.innerHeight = 850; // a pixel or two is rounding
    doc.activeElement = { tagName: "BODY" };
    fire("doc:focusout", { target: input });
    fire("doc:focusout", { target: { tagName: "BUTTON" } });
    vi.advanceTimersByTime(1000);
    expect(shell.displays).toEqual([]);
    stop();

    const tab = fakeWindow({ standalone: false });
    const tabShell = fakeShell(() => {});
    keepFullHeight(tab.win as unknown as Window, () => tabShell.el);
    expect(tab.listeners.size).toBe(0);
  });

  it("compares with the tallest height at the same width, so turning the phone isn't stuck", () => {
    const { win, doc, fire } = fakeWindow();
    const shell = fakeShell(() => {});
    keepFullHeight(win as unknown as Window, () => shell.el);
    Object.assign(win, { innerWidth: 852, innerHeight: 393 });
    fire("resize");
    doc.activeElement = { tagName: "BODY" };
    fire("doc:focusout", { target: input });
    vi.advanceTimersByTime(1000);
    expect(shell.displays).toEqual([]);
  });

  it("checks again coming back to the app, tries at most once a second, and stops cleanly", () => {
    const { win, doc, fire, listeners } = fakeWindow();
    const shell = fakeShell(() => {}); // a fix that doesn't take
    const stop = keepFullHeight(win as unknown as Window, () => shell.el);
    win.innerHeight = 793;
    fire("doc:visibilitychange");
    vi.advanceTimersByTime(1000);
    expect(shell.displays).toEqual(["none", ""]); // 150 ms tried; 450 ms waited for the cooldown

    doc.visibilityState = "hidden";
    fire("doc:visibilitychange");
    vi.advanceTimersByTime(1000);
    expect(shell.displays).toHaveLength(2);

    doc.visibilityState = "visible";
    fire("doc:focusout", { target: input });
    stop();
    vi.advanceTimersByTime(1000);
    expect(shell.displays).toHaveLength(2); // pending checks are dropped
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
