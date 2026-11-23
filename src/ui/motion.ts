/**
 * Motion started from code (Web Animations). CSS animations and transitions are turned off under
 * Reduce Motion by base.css; these check the setting themselves.
 */

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The app's easing (`--ease-out` in tokens.css), read from the element so a theme can't drift from it. */
export function easeOut(el: Element): string {
  return (typeof getComputedStyle === "function" && getComputedStyle(el).getPropertyValue("--ease-out").trim()) || "ease-out";
}

/**
 * Plays `keyframes` on `el` once, ending where the element already is (nothing is held after it
 * ends). Does nothing under Reduce Motion or where the element can't animate.
 */
export function play(el: Element | null | undefined, keyframes: Keyframe[], duration: number): void {
  if (!el || typeof el.animate !== "function" || prefersReducedMotion()) return;
  el.animate(keyframes, { duration, easing: easeOut(el) });
}

/** Whether `el` can run Web Animations (not on the server or the tests' stand-in DOM). */
export function canAnimate(el: Element | null | undefined): el is Element {
  return !!el && typeof el.animate === "function";
}

/**
 * Keyframes that grow an element out of another one's box (`from`) into its own (`to`): it starts
 * the size and place of `from`, faded out, and fills in as it grows. Reversed, it shrinks back.
 */
export function growKeyframes(from: DOMRect, to: DOMRect): Keyframe[] {
  return [
    {
      transformOrigin: "0 0",
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
      opacity: 0,
    },
    { opacity: 1, offset: 0.4 },
    { transformOrigin: "0 0", transform: "none", opacity: 1 },
  ];
}

/** The box `el` would grow out of, or null when it's gone or has no size. */
export function boxOf(el: Element | null | undefined): DOMRect | null {
  if (!el?.isConnected) return null;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? box : null;
}

let lastPress: { el: HTMLElement; at: number } | null = null;

/**
 * Remembers the control each press lands on, so a sheet it opens can grow out of it without the
 * screen passing the button along (iPhone Safari doesn't focus a tapped button). The Shell calls
 * it once; returns the cleanup.
 */
export function trackPresses(doc: Document): () => void {
  const onDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    const el = typeof target?.closest === "function" ? target.closest<HTMLElement>("button, a, label, [role='button']") : null;
    lastPress = el ? { el, at: e.timeStamp } : null;
  };
  doc.addEventListener("pointerdown", onDown, { capture: true, passive: true });
  return () => doc.removeEventListener("pointerdown", onDown, { capture: true });
}

/** The control just pressed (in the last second and a half), else the focused one (a keyboard opened it). */
export function pressedControl(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (lastPress?.el.isConnected && typeof performance !== "undefined" && performance.now() - lastPress.at < 1500) return lastPress.el;
  const focused = document.activeElement as HTMLElement | null;
  return focused && focused !== document.body ? focused : null;
}
