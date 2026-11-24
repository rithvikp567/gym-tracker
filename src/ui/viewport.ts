/**
 * Keeps the app the full height of the screen when it's on the iPhone Home Screen (D57).
 *
 * There, iOS sometimes leaves the window short after the keyboard closes: `innerHeight` and
 * `100dvh` keep the height they had with the keyboard up, so the tab bar (fixed to the bottom)
 * floats too high, with empty space under it, until WebKit measures again. Going to another page
 * did that, by replacing the page's full-height box. This does the same on purpose: once the
 * keyboard has gone, if the window is shorter than it has been at this width, it hides the
 * full-height shell and shows it again in one go (a layout in between, nothing painted), then
 * puts the scroll back.
 *
 * Only in a Home Screen app: in a Safari tab the toolbar changes the window's height as you
 * scroll, and the keyboard doesn't leave it short.
 */

/** Shorter than the tallest height by more than this is stuck (rounding moves it a pixel or two). */
const SLACK_PX = 4;
/** After a field lets go of the keyboard: checks once it has slid away (about 250 ms), and again. */
const CHECK_AFTER_MS = [150, 450] as const;
/** At most one fix this often, so a fix that doesn't take can't repeat in a loop. */
const COOLDOWN_MS = 1000;

/** Inputs that bring up no keyboard. */
const NO_KEYBOARD = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** True for an element that brings up the keyboard (or the picker wheel, for a select). */
export function opensKeyboard(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const { tagName, type, isContentEditable } = el as { tagName?: string; type?: string; isContentEditable?: boolean };
  if (tagName === "TEXTAREA" || tagName === "SELECT" || isContentEditable === true) return true;
  return tagName === "INPUT" && !NO_KEYBOARD.has((type ?? "text").toLowerCase());
}

/** Whether the page is running as an app added to the Home Screen. */
function isHomeScreenApp(win: Window): boolean {
  const standalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || (typeof win.matchMedia === "function" && win.matchMedia("(display-mode: standalone)").matches);
}

/**
 * Starts watching (see above); returns the function that stops. `shell` is the element as tall
 * as the window (the Shell's root, `min-height: 100dvh`).
 */
export function keepFullHeight(win: Window, shell: () => HTMLElement | null): () => void {
  if (!isHomeScreenApp(win)) return () => {};
  const doc = win.document;
  // The tallest the window has been at each width: the screen's height that way round.
  const tallest = new Map<number, number>();
  const measure = () => tallest.set(win.innerWidth, Math.max(tallest.get(win.innerWidth) ?? 0, win.innerHeight));
  let lastFix = -Infinity;

  const check = () => {
    measure();
    // With the keyboard up (the focus moved to the next field) short is right.
    if (opensKeyboard(doc.activeElement)) return;
    if ((tallest.get(win.innerWidth) ?? 0) - win.innerHeight <= SLACK_PX) return;
    const el = shell();
    if (!el || Date.now() - lastFix < COOLDOWN_MS) return;
    lastFix = Date.now();
    const { scrollX, scrollY } = win;
    el.style.display = "none";
    void el.offsetHeight; // lays out without it: WebKit measures the window again
    el.style.display = "";
    win.scrollTo(scrollX, scrollY);
  };

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const checkSoon = () => {
    for (const ms of CHECK_AFTER_MS) {
      const t = setTimeout(() => {
        timers.delete(t);
        check();
      }, ms);
      timers.add(t);
    }
  };
  const onFocusOut = (e: Event) => {
    if (opensKeyboard(e.target)) checkSoon();
  };
  // Back from another app or the lock screen with the keyboard having been up.
  const onVisibility = () => {
    if (doc.visibilityState === "visible") checkSoon();
  };

  measure();
  win.addEventListener("resize", measure);
  doc.addEventListener("focusout", onFocusOut, true);
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    win.removeEventListener("resize", measure);
    doc.removeEventListener("focusout", onFocusOut, true);
    doc.removeEventListener("visibilitychange", onVisibility);
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
