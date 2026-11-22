/**
 * Motion started from code (Web Animations). CSS animations and transitions are turned off under
 * Reduce Motion by base.css; these check the setting themselves.
 */

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The app's easing (`--ease-out` in tokens.css), read from the element so a theme can't drift from it. */
function easeOut(el: Element): string {
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
