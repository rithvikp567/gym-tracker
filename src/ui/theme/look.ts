/**
 * The look as colors: parsing and formatting hex colors, contrast, the Custom theme's tokens,
 * and the text color on a custom accent. Pure functions (no DOM), so they're unit-tested and
 * shared by LookSync and the color picker.
 *
 * Preset themes and accents are colored by tokens.css. A Custom theme or accent is a "token
 * override": `resolveLook` returns the custom properties to set on <html>, and LookSync saves
 * the whole resolved look under LOOK_KEY so index.html's head script can paint it before the
 * first frame without repeating this math.
 */
import { THEMES, type AccentName, type Family, type Settings, type ThemeId, type ThemeName } from "../../services/SettingsService";

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

/** Each preset theme's --bg (the browser bar's color). tokens.css is the source; tests/look.test.ts checks they match. */
export const THEME_BG: Record<ThemeId, string> = {
  light: "#f5f4f0",
  sand: "#f3ecde",
  mist: "#eef2f5",
  oled: "#000000",
  graphite: "#121214",
  midnight: "#0e131b",
};

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

/** What a Custom accent sets on <html>: its fill and the text on it, for both families. */
export const ACCENT_TOKENS = ["--accent-l", "--accent-d", "--accent-ink-l", "--accent-ink-d"] as const;

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
/**
 * How light a dark theme's background may be, and how dark a light one's: past these, text
 * can't keep 7:1 on every surface (and preset accents stay readable as text on dark ones).
 */
const DARK_MAX = 0.05;
const LIGHT_MIN = 0.55;

/** The family a color makes as a theme: light when black text reads better on it. */
export function familyOfColor(color: Rgba): Family {
  return luminance({ ...color, a: 1 }) > FAMILY_SPLIT ? "light" : "dark";
}

/**
 * Every theme token for a Custom theme color. The family comes from the color; see-through
 * means closer to that family's plain base (black for dark, white for light). The background
 * is the color, darkened or lightened only as far as readable text needs; panels, tiles and
 * lines step from it toward white in dark themes and toward black in light ones (cards in a
 * light theme are lighter than the page, like the presets); the three text colors keep at
 * least 7:1, 4.5:1 and 3:1 on the background, panel and tiles.
 */
export function customThemeTokens(color: string): { family: Family; tokens: Record<(typeof THEME_TOKENS)[number], string> } {
  const picked = parseColor(color) ?? BLACK;
  const family = familyOfColor(picked);
  const dark = family === "dark";
  const base = dark ? BLACK : WHITE;
  // Rounded to what the tokens hold, so contrast is checked on the colors that show.
  const bg = rounded(keepReadable(over(picked, base), family));
  const toward = (t: number) => rounded(mix(bg, dark ? WHITE : BLACK, t));
  const lighter = (t: number) => rounded(mix(bg, WHITE, t));

  const panel = toward(dark ? 0.035 : 0.04);
  const surface = dark ? toward(0.05) : lighter(0.7);
  const tile = dark ? toward(0.075) : lighter(0.7);
  const hairline = toward(dark ? 0.12 : 0.09);
  const grounds = [bg, panel, tile];
  const text = textColor(bg, family, grounds, 0.88, 7);
  const text3 = textColor(bg, family, grounds, 0.38, 3);
  return {
    family,
    tokens: {
      "--bg": formatColor(bg),
      "--panel": formatColor(panel),
      "--surface": formatColor(surface),
      "--surface-raised": formatColor(dark ? toward(0.11) : toward(0.035)),
      "--tile": formatColor(tile),
      "--tile-line": formatColor(toward(dark ? 0.13 : 0.09)),
      "--row-bg": formatColor(surface),
      "--row-radius": "14px",
      "--row-gap": "8px",
      "--row-pad-x": "14px",
      "--row-divider": "transparent",
      "--hairline": formatColor(hairline),
      "--hairline-strong": formatColor(toward(dark ? 0.2 : 0.17)),
      "--text": text,
      "--text-2": textColor(bg, family, grounds, 0.6, 4.5),
      "--text-3": text3,
      "--chart-grid": formatColor(toward(dark ? 0.1 : 0.07)),
      "--chart-axis": text3,
    },
  };
}

/** `bg` darkened (dark family) or lightened (light) just enough to stay inside its family's readable range. */
function keepReadable(bg: Rgba, family: Family): Rgba {
  const dark = family === "dark";
  const fits = (c: Rgba) => (dark ? luminance(c) <= DARK_MAX : luminance(c) >= LIGHT_MIN);
  if (fits(bg)) return bg;
  const base = dark ? BLACK : WHITE;
  let [lo, hi] = [0, 1]; // share of the base mixed in: hi always fits
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mix(bg, base, mid))) hi = mid;
    else lo = mid;
  }
  return mix(bg, base, hi);
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

export function resolveLook(s: LookSettings): Look {
  const vars: Record<string, string> = {};
  let family: Family;
  let bg: string;
  if (s.theme === "custom" && s.customThemeColor) {
    const custom = customThemeTokens(s.customThemeColor);
    family = custom.family;
    bg = custom.tokens["--bg"];
    Object.assign(vars, custom.tokens);
  } else {
    const preset = THEMES.find((t) => t.key === s.theme) ?? THEMES.find((t) => t.key === "oled")!;
    family = preset.family;
    bg = THEME_BG[preset.key];
  }
  const accent = s.accent === "custom" && s.customAccentColor ? parseColor(s.customAccentColor) : null;
  if (accent) {
    // One color for both families; the text on it is black or white, whichever reads better
    // on the accent as it looks over this background.
    const fill = formatColor(accent);
    const ink = inkOn(accent, parseColor(bg) ?? BLACK);
    Object.assign(vars, { "--accent-l": fill, "--accent-d": fill, "--accent-ink-l": ink, "--accent-ink-d": ink });
  }
  return { theme: s.theme, accent: s.accent, family, bg, vars };
}

/** The same look (for skipping work when nothing changed). */
export function sameLook(a: Look, b: Look): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
