import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Emitter } from "../lib/Emitter";
import { browserKeyValueStore } from "../services/SettingsService";
import { useSettings } from "./ServicesContext";
import { LOOK_KEY, LOOK_TOKENS, resolveLook, type Look, type LookSettings } from "./theme/look";

/*
 * A look shown for a moment without saving it: the color picker while you drag. It lives on
 * this device only (nothing is stamped or synced) until Use color saves it; Cancel clears it, and
 * the saved look comes back.
 */
let preview: Partial<LookSettings> | null = null;
const previews = new Emitter<Partial<LookSettings> | null>();

/**
 * Shows `changes` over the saved look on this device, or clears the preview with null. While a
 * preview shows, <html> carries data-look-preview, which turns off color transitions
 * (base.css): the page follows the wheel at once instead of easing 120–220 ms behind it.
 */
export function previewLook(changes: Partial<LookSettings> | null): void {
  preview = changes;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (changes) root.setAttribute("data-look-preview", "");
    else root.removeAttribute("data-look-preview");
  }
  previews.emit(changes);
}

const store = browserKeyValueStore();

/**
 * Keeps <html> in step with the look settings (and a preview, while one shows): its data-theme,
 * data-accent and data-family, the Custom tokens, and the browser's theme color and color scheme.
 * The saved look is also kept under LOOK_KEY, so index.html paints it before the next first frame.
 * Applied in a layout effect: before the browser paints, and before screens' effects that read
 * token colors (the chart).
 */
export function LookSync() {
  const settings = useSettings();
  const [shown, setShown] = useState(preview);
  useEffect(() => previews.subscribe(setShown), []);
  const { theme, customThemeColor, accent, customAccentColor } = settings;
  const saved = useMemo(
    () => resolveLook({ theme, customThemeColor, accent, customAccentColor }),
    [theme, customThemeColor, accent, customAccentColor],
  );
  const look = useMemo(
    () => (shown ? resolveLook({ theme, customThemeColor, accent, customAccentColor, ...shown }) : saved),
    [shown, saved, theme, customThemeColor, accent, customAccentColor],
  );

  useLayoutEffect(() => applyLook(document, look), [look]);
  useEffect(() => store.set(LOOK_KEY, JSON.stringify(saved)), [saved]);
  return null;
}

/** Puts `look` on the page (index.html's head script does the same from the saved copy). */
export function applyLook(doc: Document, look: Look): void {
  const root = doc.documentElement;
  root.dataset.theme = look.theme;
  root.dataset.accent = look.accent;
  root.dataset.family = look.family;
  for (const name of LOOK_TOKENS) if (!(name in look.vars)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(look.vars)) root.style.setProperty(name, value);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", look.bg);
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute("content", look.family);
}
