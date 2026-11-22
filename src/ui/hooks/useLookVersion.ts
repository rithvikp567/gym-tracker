import { useEffect, useState } from "react";

/** What on <html> carries the look: the theme, accent and light/dark family, and a Custom theme's tokens. */
const LOOK_ATTRIBUTES = ["data-theme", "data-accent", "data-family", "style"];

/**
 * A number that changes each time the look on <html> changes, for code that reads token colors
 * itself (getComputedStyle) instead of using them in CSS: put it in that memo's dependencies.
 * It changes after the new look is on the page, so the colors read then are the new ones (a
 * dependency on the theme setting alone would re-read before the look is applied, and would miss
 * a Custom color moving from dark to light under the same "custom" id).
 */
export function useLookVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver !== "function" || typeof document === "undefined") return;
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: LOOK_ATTRIBUTES });
    return () => observer.disconnect();
  }, []);
  return version;
}
