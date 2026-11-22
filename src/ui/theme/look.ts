/**
 * The look as colors: parsing and formatting hex colors, contrast, the Custom theme's tokens,
 * and the accent's fill and text color where tokens.css can't know them. Pure functions (no
 * DOM), so they're unit-tested and shared by LookSync and the color picker.
 *
 * Preset themes and accents are colored by tokens.css. A Custom theme or accent is a "token
 * override": `resolveLook` returns the custom properties to set on <html>, and LookSync saves
 * the whole resolved look under LOOK_KEY so index.html's head script can paint it before the
 * first frame without repeating this math.
 */
import { THEMES, type AccentId, type AccentName, type Family, type Settings, type ThemeId, type ThemeName } from "../../services/SettingsService";

/** A color: r, g, b 0–255, a (opacity) 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The same color as hue 0–360, saturation and value (brightness) 0–1, and opacity 0–1. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Where the resolved look is kept for index.html's head script. */
export const LOOK_KEY = "gym-tracker.look";

/** What text and the accent sit on: a theme's page, panels, surfaces and tiles. */
export interface Grounds {
  bg: string;
  panel: string;
  surface: string;
  surfaceRaised: string;
  tile: string;
}

/**
 * Each preset theme's grounds. tokens.css is the source; tests/look.test.ts checks they match.
 * `bg` is also the browser bar's color, and the rest is what a custom accent must read on.
 */
export const THEME_GROUNDS: Record<ThemeId, Grounds> = {
  light: { bg: "#f5f4f0", panel: "#ebeae5", surface: "#ffffff", surfaceRaised: "#eeede8", tile: "#ffffff" },
  sand: { bg: "#f3ecde", panel: "#e9e0ce", surface: "#fcf8f0", surfaceRaised: "#ece4d4", tile: "#fcf8f0" },
  mist: { bg: "#eef2f5", panel: "#e2e8ee", surface: "#ffffff", surfaceRaised: "#e6ecf1", tile: "#ffffff" },
  oled: { bg: "#000000", panel: "#0c0c0d", surface: "#0e0e0f", surfaceRaised: "#18181a", tile: "#161618" },
  graphite: { bg: "#121214", panel: "#18181b", surface: "#1c1c20", surfaceRaised: "#26262b", tile: "#222226" },
  midnight: { bg: "#0e131b", panel: "#131a24", surface: "#151c26", surfaceRaised: "#222c3a", tile: "#1a2230" },
};

/** Each preset theme's --bg (the browser bar's color). */
export const THEME_BG = Object.fromEntries(Object.entries(THEME_GROUNDS).map(([k, g]) => [k, g.bg])) as Record<ThemeId, string>;

/**
 * Each preset accent's fill per family (tokens.css is the source; tests check they match).
 * Ink has none: it's the theme's text color, which reads everywhere already.
 */
export const ACCENT_FILLS: Record<Exclude<AccentId, "ink">, Record<Family, string>> = {
  lime: { light: "#3f6a0a", dark: "#c6f432" },
  blue: { light: "#2a5f9e", dark: "#7db7ff" },
  teal: { light: "#0c6a65", dark: "#4fd1c5" },
  amber: { light: "#805b0e", dark: "#f2b84b" },
  orange: { light: "#9e4219", dark: "#ff9a62" },
  purple: { light: "#6a48ae", dark: "#b9a2f2" },
  pink: { light: "#a33361", dark: "#f48dbb" },
};

/** How well the accent reads as text (links, numbers, today's date) on every ground. */
export const ACCENT_TEXT = 4.5;

/** The tokens every theme sets (tokens.css), which a Custom theme sets on <html> instead. */
export const THEME_TOKENS = [
  "--bg",
  "--panel",
  "--surface",
  "--surface-raised",
  "--tile",
  "--tile-line",
  "--row-bg",
  "--row-radius",
  "--row-gap",
  "--row-pad-x",
  "--row-divider",
  "--hairline",
  "--hairline-strong",
  "--text",
  "--text-2",
  "--text-3",
  "--chart-grid",
  "--chart-axis",
] as const;

/**
 * What a Custom accent sets on <html>, for both families: its fill (as picked), the text on it,
 * and the accent as text where the fill itself wouldn't read (--accent-text-*).
 */
export const ACCENT_TOKENS = ["--accent-l", "--accent-d", "--accent-ink-l", "--accent-ink-d", "--accent-text-l", "--accent-text-d"] as const;

/** Every custom property LookSync may set, so it can clear the ones a new look doesn't use. */
export const LOOK_TOKENS: readonly string[] = [...THEME_TOKENS, ...ACCENT_TOKENS];

// ───────────── Hex colors ─────────────

/**
 * A color typed or stored as hex: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, with or without
 * the `#`, any case, spaces around it ignored. Anything else is null.
 */
export function parseColor(text: string): Rgba | null {
  const hex = text.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const byte = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
}

/** The stored form: lowercase `#rrggbb`, plus two alpha digits when it's see-through. */
export function formatColor(c: Rgba): string {
  const byte = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  const alpha = Math.round(clamp(c.a, 0, 1) * 255);
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${alpha === 255 ? "" : byte(alpha)}`;
}

// ───────────── Contrast ─────────────

/** WCAG relative luminance of the color's opaque part. */
export function luminance(c: Rgba): number {
  const channel = (n: number) => {
    const x = n / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `a` moved toward `b` by `t` (0 = a, 1 = b), opaque. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const at = (x: number, y: number) => x + (y - x) * t;
  return { r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b), a: 1 };
}

/** What a see-through `top` looks like over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  return mix(bottom, { ...top, a: 1 }, top.a);
}

/**
 * Black or white, whichever reads better on `fill` (a see-through fill as it looks over
 * `behind`). Either one always reaches at least 4.5:1.
 */
export function inkOn(fill: Rgba, behind: Rgba): string {
  const seen = over(fill, behind);
  return contrast(BLACK, seen) >= contrast(WHITE, seen) ? "#000000" : "#ffffff";
}

// ───────────── Hue, saturation, brightness (the color wheel) ─────────────

export function toHsva(c: Rgba, hueIfGray = 0): Hsva {
  const [r, g, b] = [c.r / 255, c.g / 255, c.b / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = hueIfGray;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: c.a };
}

export function fromHsva({ h, s, v, a }: Hsva): Rgba {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

// ───────────── The Custom theme ─────────────

/** Luminance where black and white text read equally well: lighter colors make light themes. */
const FAMILY_SPLIT = Math.sqrt(1.05 * 0.05) - 0.05;
/** The text contrast a Custom theme keeps on every ground: --text, --text-2, --text-3. */
const TEXT_RATIOS = [7, 4.5, 3] as const;

/** The family a color makes as a theme: light when black text reads better on it. */
export function familyOfColor(color: Rgba): Family {
  return luminance({ ...color, a: 1 }) > FAMILY_SPLIT ? "light" : "dark";
}

/**
 * Every theme token for a Custom theme color. The family comes from the color; see-through
 * means closer to that family's plain base (black for dark, white for light). The background
 * is the color, darkened or lightened only when text couldn't otherwise reach 7:1 on it and on
 * what's laid over it; panels, tiles and lines step from it toward white in dark themes and
 * toward black in light ones (cards in a light theme are lighter than the page, like the
 * presets); the three text colors keep at least 7:1, 4.5:1 and 3:1 on all of those grounds.
 */
export function customThemeTokens(color: string): { family: Family; tokens: Record<(typeof THEME_TOKENS)[number], string> } {
  const picked = parseColor(color) ?? BLACK;
  const family = familyOfColor(picked);
  const dark = family === "dark";
  const bg = keepReadable(rounded(over(picked, dark ? BLACK : WHITE)), family);
  const toward = (t: number) => rounded(mix(bg, dark ? WHITE : BLACK, t));
  const g = laidOver(bg, family);
  const grounds = [bg, g.panel, g.surface, g.surfaceRaised, g.tile];
  const text3 = textColor(bg, family, grounds, 0.38, TEXT_RATIOS[2]);
  return {
    family,
    tokens: {
      "--bg": formatColor(bg),
      "--panel": formatColor(g.panel),
      "--surface": formatColor(g.surface),
      "--surface-raised": formatColor(g.surfaceRaised),
      "--tile": formatColor(g.tile),
      "--tile-line": formatColor(toward(dark ? 0.13 : 0.09)),
      "--row-bg": formatColor(g.surface),
      "--row-radius": "14px",
      "--row-gap": "8px",
      "--row-pad-x": "14px",
      "--row-divider": "transparent",
      "--hairline": formatColor(toward(dark ? 0.12 : 0.09)),
      "--hairline-strong": formatColor(toward(dark ? 0.2 : 0.17)),
      "--text": textColor(bg, family, grounds, 0.88, TEXT_RATIOS[0]),
      "--text-2": textColor(bg, family, grounds, 0.6, TEXT_RATIOS[1]),
      "--text-3": text3,
      "--chart-grid": formatColor(toward(dark ? 0.1 : 0.07)),
      "--chart-axis": text3,
    },
  };
}

/** The grounds a Custom theme lays over its background (rounded to what the tokens hold). */
function laidOver(bg: Rgba, family: Family): Omit<Record<keyof Grounds, Rgba>, "bg"> {
  const dark = family === "dark";
  const toward = (t: number) => rounded(mix(bg, dark ? WHITE : BLACK, t));
  const lighter = (t: number) => rounded(mix(bg, WHITE, t));
  return {
    panel: toward(dark ? 0.035 : 0.04),
    surface: dark ? toward(0.05) : lighter(0.7),
    surfaceRaised: dark ? toward(0.11) : toward(0.035),
    tile: dark ? toward(0.075) : lighter(0.7),
  };
}

/**
 * `bg` as it is when plain white (dark family) or black (light) text reaches 7:1 on it and on
 * everything laid over it; otherwise darkened or lightened just that far, keeping its hue.
 */
function keepReadable(bg: Rgba, family: Family): Rgba {
  const dark = family === "dark";
  const end = dark ? WHITE : BLACK;
  const fits = (c: Rgba) => [c, ...Object.values(laidOver(c, family))].every((g) => contrast(end, g) >= TEXT_RATIOS[0]);
  if (fits(bg)) return bg;
  const base = dark ? BLACK : WHITE;
  let [lo, hi] = [0, 1]; // share of the base mixed in: hi always fits
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(rounded(mix(bg, base, mid)))) hi = mid;
    else lo = mid;
  }
  return rounded(mix(bg, base, hi));
}

/**
 * A text color tinted by the background: from `start` of the way to white (dark family) or
 * black (light), as little further as it takes to reach `ratio` on every ground.
 */
function textColor(bg: Rgba, family: Family, grounds: Rgba[], start: number, ratio: number): string {
  const end = family === "dark" ? WHITE : BLACK;
  for (let t = start; t < 1; t += 0.01) {
    const c = rounded(mix(bg, end, t));
    if (grounds.every((g) => contrast(c, g) >= ratio)) return formatColor(c);
  }
  return formatColor(end);
}

/** The color as its hex form holds it (whole channels). */
function rounded(c: Rgba): Rgba {
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: c.a };
}

// ───────────── The accent ─────────────

/**
 * An accent fill that reads as text at 4.5:1 on every ground: `fill` itself when it does,
 * else lightened (dark family) or darkened (light) just that far, keeping its hue, like the
 * presets' separate light and dark fills. Checked as if opaque; a see-through fill keeps its
 * opacity.
 */
export function readableAccent(fill: Rgba, family: Family, grounds: readonly Rgba[]): Rgba {
  const end = family === "dark" ? WHITE : BLACK;
  const opaque = rounded({ ...fill, a: 1 });
  const reads = (c: Rgba) => grounds.every((g) => contrast(c, g) >= ACCENT_TEXT);
  if (reads(opaque)) return fill;
  let [lo, hi] = [0, 1]; // share of the end mixed in: hi always reads (plain white or black)
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (reads(rounded(mix(opaque, end, mid)))) hi = mid;
    else lo = mid;
  }
  return { ...rounded(mix(opaque, end, hi)), a: fill.a };
}

// ───────────── The whole look ─────────────

/** The look to show, resolved: what <html> gets and what the head script repeats before the first frame. */
export interface Look {
  theme: ThemeName;
  accent: AccentName;
  family: Family;
  /** The page background, for the browser bar (`<meta name="theme-color">`). */
  bg: string;
  /** Custom properties to set on <html> (the Custom theme's and accent's tokens); empty for presets. */
  vars: Record<string, string>;
}

export type LookSettings = Pick<Settings, "theme" | "customThemeColor" | "accent" | "customAccentColor">;

const FAMILIES: readonly Family[] = ["light", "dark"];
const slot = (family: Family) => (family === "light" ? "l" : "d");

/** The accent fill token the page uses in `family` (`--accent-l` or `--accent-d`). */
export function accentFillToken(family: Family): string {
  return `--accent-${slot(family)}`;
}

export function resolveLook(s: LookSettings): Look {
  const vars: Record<string, string> = {};
  // Per family: where the accent must read, and what a see-through accent shows over.
  const grounds: Record<Family, Rgba[]> = { light: presetGrounds("light"), dark: presetGrounds("dark") };
  const behind: Record<Family, Rgba> = { light: parseColor(THEME_BG.light)!, dark: parseColor(THEME_BG.oled)! };
  let family: Family;
  let bg: string;
  const customTheme = s.theme === "custom" && s.customThemeColor ? customThemeTokens(s.customThemeColor) : null;
  if (customTheme) {
    const t = customTheme.tokens;
    family = customTheme.family;
    bg = t["--bg"];
    Object.assign(vars, t);
    grounds[family] = [t["--bg"], t["--panel"], t["--surface"], t["--surface-raised"], t["--tile"]].map((c) => parseColor(c)!);
  } else {
    const preset = THEMES.find((t) => t.key === s.theme) ?? THEMES.find((t) => t.key === "oled")!;
    family = preset.family;
    bg = THEME_BG[preset.key];
  }
  behind[family] = parseColor(bg)!;

  // Where the accent is text (links, today's date, numbers) it must read at 4.5:1; where it is a
  // fill (buttons, switches, the picked tab) it stays the color as picked, with black or white
  // text on it. So only the text color moves, and only when the fill wouldn't read as text.
  const setText = (f: Family, fill: Rgba) => {
    const text = readableAccent({ ...over(fill, behind[f]), a: 1 }, f, grounds[f]);
    if (formatColor(text) !== formatColor({ ...fill, a: 1 }) || fill.a < 1) vars[`--accent-text-${slot(f)}`] = formatColor(text);
  };
  const custom = s.accent === "custom" && s.customAccentColor ? parseColor(s.customAccentColor) : null;
  if (custom) {
    for (const f of FAMILIES) {
      vars[`--accent-${slot(f)}`] = formatColor(custom);
      vars[`--accent-ink-${slot(f)}`] = inkOn(custom, behind[f]);
      setText(f, custom);
    }
  } else if (customTheme && s.accent !== "ink" && s.accent !== "custom") {
    // A preset accent is made for the preset themes; on a Custom one its text color moves if it must.
    setText(family, parseColor(ACCENT_FILLS[s.accent][family])!);
  }
  return { theme: s.theme, accent: s.accent, family, bg, vars };
}

/** Every ground of the preset themes in `family`. */
function presetGrounds(family: Family): Rgba[] {
  return THEMES.filter((t) => t.family === family).flatMap((t) => Object.values(THEME_GROUNDS[t.key]).map((c) => parseColor(c)!));
}

/** The same look (for skipping work when nothing changed). */
export function sameLook(a: Look, b: Look): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
