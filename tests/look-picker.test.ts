import { act, createElement, Fragment, StrictMode } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { NoSocial } from "../src/data/NoSocial";
import { NoSync } from "../src/data/NoSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { BackupService } from "../src/services/BackupService";
import { CalendarService } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { SettingsService } from "../src/services/SettingsService";
import { SocialService } from "../src/services/SocialService";
import { TimerService } from "../src/services/TimerService";
import { SetupService } from "../src/services/SetupService";
import { LookSync, previewLook } from "../src/ui/LookSync";
import { LookSettings } from "../src/ui/screens/settings/LookSettings";
import { ServicesProvider } from "../src/ui/ServicesContext";
import { customThemeTokens, LOOK_KEY } from "../src/ui/theme/look";

/*
 * The color picker mounted with react-dom next to LookSync, so the rules about what it saves
 * and what it shows are checked end to end: dragging previews on <html> and writes nothing,
 * Use color writes one settings update, and every way out without it (Cancel, Escape, a tap
 * outside, leaving the screen, a route change) puts the saved look back.
 *
 * Tests run in Node with no DOM library, so this is a small stand-in for the DOM: what React
 * needs to build elements, plus events that travel capture → target → bubble through the
 * tree, which is how React's listeners on the root and on <body> (the picker's portal) see them.
 * react-dom/client is loaded once the stand-in is in place, so it takes this for a browser and
 * listens for `input` events (sliders) as it does in one.
 */

const HTML = "http://www.w3.org/1999/xhtml";
type Listener = (event: FakeEvent) => void;
type ListenerOptions = boolean | { capture?: boolean } | undefined;
const isCapture = (options: ListenerOptions) => (typeof options === "boolean" ? options : !!options?.capture);

interface FakeEvent {
  type: string;
  target: FakeNode;
  defaultPrevented: boolean;
  stopPropagation(): void;
  preventDefault(): void;
  [key: string]: unknown;
}

class FakeNode {
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  readonly listeners: { type: string; listener: Listener; capture: boolean }[] = [];

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

  addEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    this.listeners.push({ type, listener, capture: isCapture(options) });
  }

  removeEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    const i = this.listeners.findIndex((l) => l.type === type && l.listener === listener && l.capture === isCapture(options));
    if (i >= 0) this.listeners.splice(i, 1);
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

/** A style declaration: custom properties by name, the rest as plain fields (React sets both ways). */
function fakeStyle() {
  const props = new Map<string, string>();
  return Object.assign(Object.create(null) as Record<string, unknown>, {
    props,
    setProperty: (name: string, value: string) => void props.set(name, String(value)),
    removeProperty: (name: string) => void props.delete(name),
    getPropertyValue: (name: string) => props.get(name) ?? "",
  });
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = fakeStyle();
  readonly dataset: Record<string, string>;

  constructor(
    doc: FakeDocument,
    readonly localName: string,
    readonly namespaceURI: string,
  ) {
    super(doc, 1, namespaceURI === HTML ? localName.toUpperCase() : localName);
    this.tagName = this.nodeName;
    const kebab = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, key) => this.attributes.get(kebab(String(key))),
      set: (_t, key, value: string) => (this.attributes.set(kebab(String(key)), String(value)), true),
    });
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

  focus(): void {}
  private captured = new Set<number>();
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }

  /** Enough of closest() for `[name="value"]` and `.class`. */
  closest(selector: string): FakeElement | null {
    const attr = /^\[([a-z-]+)="([^"]*)"\]$/.exec(selector);
    const matches = (el: FakeElement) =>
      attr ? el.getAttribute(attr[1]!) === attr[2] : selector.startsWith(".") && (el.getAttribute("class") ?? "").split(" ").includes(selector.slice(1));
    for (let n: FakeNode | null = this; n; n = n.parentNode) if (n instanceof FakeElement && matches(n)) return n;
    return null;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 200, bottom: 200, width: 200, height: 200 };
  }
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  readonly activeElement = null;
  /** React checks `"oninput" in document` to know `input` events exist. */
  readonly oninput = null;
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

  querySelector(): null {
    return null;
  }
}

/** Sends an event down to `target` and back up, as a browser does; stops where a listener says. */
function dispatch(target: FakeNode, type: string, init: Record<string, unknown> = {}): void {
  const path: FakeNode[] = [];
  for (let n: FakeNode | null = target; n; n = n.parentNode) path.push(n);
  let stopped = false;
  const event: FakeEvent = {
    type,
    target,
    bubbles: true,
    timeStamp: 0,
    button: 0,
    pointerId: 1,
    ...init,
    defaultPrevented: false,
    stopPropagation: () => void (stopped = true),
    preventDefault: () => void (event.defaultPrevented = true),
  };
  const run = (node: FakeNode, capture: boolean) => {
    for (const l of node.listeners.filter((x) => x.type === type && x.capture === capture)) l.listener(event);
  };
  for (const node of [...path].reverse()) if (!stopped) run(node, true);
  for (const node of path) if (!stopped) run(node, false);
}

const doc = new FakeDocument();
const html = doc.documentElement;
const win = Object.assign(new FakeNode(null, 0, "#window"), { document: doc, event: undefined, HTMLIFrameElement: class {} });
doc.defaultView = win;

function findAll(node: FakeNode, match: (el: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (n: FakeNode) => {
    if (n instanceof FakeElement && match(n)) found.push(n);
    n.childNodes.forEach(walk);
  };
  walk(node);
  return found;
}

const byClass = (name: string) => findAll(doc.body, (el) => (el.getAttribute("class") ?? "").split(" ").includes(name));
const byLabel = (label: string) => findAll(doc.body, (el) => el.getAttribute("aria-label") === label)[0]!;
const button = (text: string) => findAll(doc.body, (el) => el.localName === "button" && el.textContent === text)[0]!;
const pickerOpen = () => byClass("sheet").length > 0;

function makeServices(): AppServices {
  const clock = { now: () => new Date(2026, 10, 20, 12) };
  const repos = new StoreRepositories(new MemoryRecordStore(), clock);
  const prefs = new Map<string, string>();
  const deviceStore = { get: (k: string) => prefs.get(k) ?? null, set: (k: string, v: string) => void prefs.set(k, v) };
  const settings = new SettingsService(deviceStore, clock);
  return {
    mode: "device",
    changes: repos.changes,
    setup: new SetupService(repos),
    sessions: new SessionService(repos),
    calendar: new CalendarService(repos, clock),
    progress: new ProgressService(repos, clock),
    imports: new ImportService(repos),
    backup: new BackupService(repos),
    settings,
    sync: new NoSync(),
    social: new SocialService(new NoSocial(), repos, clock),
    timer: new TimerService(deviceStore, settings, clock),
  };
}

let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | null = null;
let container: FakeElement | null = null;
let services: AppServices;
let saved: Map<string, string>;

/** LookSync (as App has it) and, while `settingsOpen`, the Appearance card. */
function render(settingsOpen = true): void {
  const children = createElement(Fragment, null, createElement(LookSync), settingsOpen ? createElement(LookSettings) : null);
  act(() => root!.render(createElement(StrictMode, null, createElement(ServicesProvider, { services, children }))));
}

/** The look on <html>: its ids and the custom properties set on it. */
const shown = () => ({ theme: html.dataset.theme, accent: html.dataset.accent, vars: Object.fromEntries(html.style.props as Map<string, string>) });

function click(el: FakeElement): void {
  act(() => {
    dispatch(el, "pointerdown");
    dispatch(el, "click");
  });
}

/** Moves a slider (brightness or opacity) to `value`, as dragging its thumb does. */
function slide(range: FakeElement, value: number): void {
  act(() => {
    (range as unknown as { value: string }).value = String(value);
    dispatch(range, "input");
  });
}

beforeAll(async () => {
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  ({ createRoot } = await import("react-dom/client"));
});

beforeEach(() => {
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#c6f432" }));
  saved = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) });
  services = makeServices();
  container = doc.body.appendChild(doc.createElement("div"));
  root = createRoot(container as unknown as Element);
  render();
});

afterEach(() => {
  act(() => root?.unmount());
  doc.body.removeChild(container!);
  for (const leftover of [...doc.body.childNodes]) doc.body.removeChild(leftover);
  html.attributes.clear();
  (html.style.props as Map<string, string>).clear();
  previewLook(null);
  vi.unstubAllGlobals();
});

describe("the color picker", () => {
  it("previews a slider move on this device only, and Use color saves once", () => {
    const update = vi.spyOn(services.settings, "update");
    const writes = vi.spyOn(localStorage, "setItem");
    click(byLabel("Custom accent color"));
    expect(pickerOpen()).toBe(true);

    const [brightness, opacity] = byClass("cp-range");
    slide(brightness!, 40);
    slide(brightness!, 55);
    slide(opacity!, 80);
    expect(update).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled(); // neither the settings nor the saved look
    expect(shown().accent).toBe("custom");
    expect(shown().vars["--accent-d"]).toBeDefined();
    // Colors follow the drag at once: base.css turns transitions off while this is on <html>.
    expect(html.getAttribute("data-look-preview")).toBe("");

    click(button("Use color"));
    expect(pickerOpen()).toBe(false);
    expect(html.getAttribute("data-look-preview")).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    const picked = services.settings.get().customAccentColor!;
    expect(picked).toMatch(/^#[0-9a-f]{8}$/); // 80% opacity
    expect(update).toHaveBeenCalledWith({ accent: "custom", customAccentColor: picked, recentAccentColors: [picked] });
    expect(shown().accent).toBe("custom");
    expect(JSON.parse(saved.get(LOOK_KEY)!)).toMatchObject({ accent: "custom" });
  });

  it("applies a wheel drag to the page when you let go, not while you hold, and saves only on Use color", async () => {
    const frame = () => act(async () => void (await new Promise((r) => setTimeout(r, 5)))); // the wheel applies moves once per frame
    const update = vi.spyOn(services.settings, "update");
    click(byLabel("Custom accent color"));
    const wheel = byClass("cp-wheel")[0]!;
    act(() => {
      dispatch(wheel, "pointerdown", { clientX: 20, clientY: 50 });
      dispatch(wheel, "pointermove", { clientX: 25, clientY: 60 });
    });
    await frame();
    // Held: the picker follows, the page still shows what it had.
    const [before, after] = byClass("cp-compare")[0]!.childNodes as unknown as FakeElement[];
    expect(after!.style.getPropertyValue("--swatch")).not.toBe(before!.style.getPropertyValue("--swatch"));
    expect(shown()).toEqual({ theme: "oled", accent: "blue", vars: {} });
    act(() => dispatch(win, "pointerup"));
    await frame();
    expect(shown().accent).toBe("custom"); // let go: applied at once
    expect(update).not.toHaveBeenCalled(); // but not kept until Use color
    click(button("Use color"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(services.settings.get().accent).toBe("custom");
  });

  it("puts the saved look back on Cancel, Escape and a tap outside, saving nothing", () => {
    const update = vi.spyOn(services.settings, "update");
    const ways: Record<string, () => void> = {
      Cancel: () => click(button("Cancel")),
      Escape: () => act(() => dispatch(win, "keydown", { key: "Escape" })),
      "a tap outside": () => click(byClass("sheet-backdrop")[0]!),
    };
    for (const [way, leave] of Object.entries(ways)) {
      click(byLabel("Custom theme"));
      slide(byClass("cp-range")[0]!, 70);
      expect(shown().theme, way).toBe("custom");
      leave();
      expect(pickerOpen(), way).toBe(false);
      expect(shown(), way).toEqual({ theme: "oled", accent: "blue", vars: {} });
      expect(html.getAttribute("data-look-preview"), way).toBeNull();
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("shows a recent theme color, and the opacity slider, as the page would look: a theme never shows through", () => {
    act(() => services.settings.update({ recentThemeColors: ["#3366ff80"] }));
    click(byLabel("Custom theme"));
    const swatch = byClass("cp-recent-color")[0]!;
    expect(swatch.style.getPropertyValue("--swatch")).toBe(customThemeTokens("#3366ff80").tokens["--bg"]);
    expect(swatch.style.getPropertyValue("--swatch")).toMatch(/^#[0-9a-f]{6}$/); // opaque
    // Fully see-through is plain black for a dark color.
    const opacity = byClass("cp-range")[1]!;
    expect(byClass("cp-track")[1]!.style.getPropertyValue("--track")).toMatch(/^linear-gradient\(to right, #000000, #[0-9a-f]{6}\)$/);
    expect(opacity.style.getPropertyValue("--thumb")).toMatch(/^#[0-9a-f]{6}$/);
    click(button("Cancel"));

    // An accent does show through: its recent colors keep their opacity, over the checkerboard.
    act(() => services.settings.update({ recentAccentColors: ["#3366ff80"] }));
    click(byLabel("Custom accent color"));
    expect(byClass("cp-recent-color")[0]!.style.getPropertyValue("--swatch")).toBe("#3366ff80");
  });

  it("keeps open when a press inside is let go outside (selecting the hex text past the edge)", () => {
    click(byLabel("Custom theme"));
    slide(byClass("cp-range")[0]!, 70);
    const hex = byClass("cp-hex")[0]!;
    const backdrop = byClass("sheet-backdrop")[0]!;
    act(() => {
      dispatch(hex, "pointerdown");
      dispatch(backdrop, "click"); // the click lands on what both share
    });
    expect(pickerOpen()).toBe(true);
    expect(shown().theme).toBe("custom");
    click(backdrop); // a real tap outside still cancels
    expect(pickerOpen()).toBe(false);
    expect(shown().theme).toBe("oled");
  });

  it("drops the preview when you leave Settings with the picker open, so later picks show", () => {
    click(byLabel("Custom theme"));
    slide(byClass("cp-range")[0]!, 70);
    expect(shown().theme).toBe("custom");
    render(false); // Back, a swipe, another tab: the screen goes, the picker with it
    expect(shown()).toEqual({ theme: "oled", accent: "blue", vars: {} });
    act(() => services.settings.update({ theme: "sand" }));
    expect(shown().theme).toBe("sand");
  });

  it("closes and restores on a route change, even before the screen goes", () => {
    click(byLabel("Custom accent color"));
    slide(byClass("cp-range")[0]!, 30);
    expect(shown().accent).toBe("custom");
    act(() => dispatch(win, "hashchange"));
    expect(pickerOpen()).toBe(false);
    expect(shown()).toEqual({ theme: "oled", accent: "blue", vars: {} });
  });
});
