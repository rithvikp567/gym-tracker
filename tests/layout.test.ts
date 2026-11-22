import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterBlock } from "../src/ui/components/CenterBlock";
import { ScreenHead } from "../src/ui/components/controls";
import { holdWindow, pageOf, tabOf } from "../src/ui/pageLayout";
import type { Route } from "../src/ui/router";
import { Shell } from "../src/ui/Shell";
import { onSlide, slideNext, useSlide } from "../src/ui/slide";

/*
 * The tile layout's logic: which tab and page a route belongs to, the page's hold while you step
 * through days, and what the Shell draws (rendered once, no effects).
 */

const ROUTES: [Route, ReturnType<typeof tabOf>, ReturnType<typeof pageOf>][] = [
  [{ name: "home" }, "home", "home"],
  [{ name: "session", dayId: "u1", date: "2026-11-20" }, "home", "workout"],
  [{ name: "day", date: "2026-11-21" }, "home", "workout"],
  [{ name: "calendar", year: null }, "calendar", "calendar"],
  [{ name: "calendar", year: 2025 }, "calendar", "calendar"],
  [{ name: "progress", dayId: null }, "progress", "progress"],
  [{ name: "progress", dayId: "u1" }, "progress", "progress"],
  [{ name: "settings" }, "settings", "settings"],
  [{ name: "setup" }, "settings", "setup"],
  [{ name: "setup", dayId: "u1" }, "settings", "setup"],
  [{ name: "import" }, "settings", "import"],
];

describe("tabs and pages", () => {
  it.each(ROUTES)("%o is under the %s tab, on the %s page", (route, tab, page) => {
    expect(tabOf(route)).toBe(tab);
    expect(pageOf(route)).toBe(page);
  });

  it("keeps a workout and the rest days around it one page, so stepping between them never switches pages", () => {
    const pages = new Set(ROUTES.filter(([r]) => r.name === "session" || r.name === "day").map(([r]) => pageOf(r)));
    expect([...pages]).toEqual(["workout"]);
  });
});

describe("hold window (the page holds still through day steps)", () => {
  afterEach(() => void vi.useRealTimers());

  it("holds from the first poke until a while after the last one", () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const steps = holdWindow(1200, (held) => changes.push(held));

    steps.poke();
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1000);
    steps.poke(); // a second step: still held, and the wait starts over
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(200);
    expect(changes).toEqual([true, false]);

    steps.poke(); // a later step holds again
    expect(changes).toEqual([true, false, true]);
  });

  it("lets nothing fire after it is disposed", () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const steps = holdWindow(500, (held) => changes.push(held));
    steps.poke();
    steps.dispose();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true]);
  });
});

describe("slides", () => {
  it("tells listeners about each step, and hands the direction to the next screen once", () => {
    const heard: string[] = [];
    const off = onSlide(() => heard.push("step"));
    slideNext("forward");
    slideNext("back");
    off();
    slideNext("forward");
    expect(heard).toEqual(["step", "step"]);

    // The last direction set is what the next screen reads (one render, no effects).
    let seen: unknown = "unset";
    const Probe = () => {
      seen = useSlide("a");
      return null;
    };
    renderToString(createElement(Probe));
    expect(seen).toBe("forward");
    renderToString(createElement(Probe));
    expect(seen).toBeNull();
  });
});

describe("shell", () => {
  const shell = (route: Route) => renderToString(createElement(Shell, { route, children: createElement("p", null, "Screen") }));

  it("draws Gym Tracker and the four tabs, the current one marked", () => {
    const html = shell({ name: "session", dayId: "u1", date: "2026-11-20" });
    expect(html).toContain("<span>Gym Tracker</span>");
    expect(html.match(/class="tab"/g)).toHaveLength(4);
    expect(html).toMatch(/<a class="tab" href="#\/" aria-current="page">/);
    expect(html).not.toMatch(/href="#\/calendar" aria-current/);
    expect(html).toContain('class="tab-marker"');
  });

  it("centers the screen in one page block marked with its page, with no fade on the first page", () => {
    const html = shell({ name: "calendar", year: null });
    expect(html).toMatch(/<main class="shell-main"><div class="center-block page"><div class="center-block-content page-content" data-page="calendar"><p>Screen<\/p>/);
    expect(html).not.toContain("page-in");
    expect(html).toMatch(/href="#\/calendar" aria-current="page"/);
  });
});

describe("centered blocks and headers", () => {
  it("holds a block where it is (top-aligned) while held", () => {
    const render = (hold: boolean) => renderToString(createElement(CenterBlock, { hold, children: "x" }));
    expect(render(false)).toContain('class="center-block"');
    expect(render(true)).toContain('class="center-block is-held"');
  });

  it("puts a screen's title in the middle and its actions in their own column on the right", () => {
    const plain = renderToString(createElement(ScreenHead, { title: "Progress", sub: "Heaviest set" }));
    expect(plain).toBe('<header class="screen-head"><div class="head-text"><h1>Progress</h1><div class="sub">Heaviest set</div></div></header>');
    const withDone = renderToString(createElement(ScreenHead, { title: "Workout Days", actions: createElement("a", null, "Done") }));
    expect(withDone).toContain('<div class="head-actions"><a>Done</a></div>');
  });
});
