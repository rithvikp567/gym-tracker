import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, THEMES, type Family } from "../src/services/SettingsService";
import { applyLook } from "../src/ui/LookSync";
import {
  ACCENT_FILLS,
  ACCENT_SOFT,
  ACCENT_TOKENS,
  accentFillToken,
  contrast,
  customThemeTokens,
  familyOfColor,
  formatColor,
  fromHsva,
  inkOn,
  LOOK_KEY,
  LOOK_TOKENS,
  luminance,
  MARK_COLORS,
  MARK_TOKENS,
  mix,
  over,
  parseColor,
  readableAccent,
  resolveLook,
  THEME_BG,
  THEME_GROUNDS,
  THEME_TOKENS,
  toHsva,
  type Look,
  type Rgba,
} from "../src/ui/theme/look";

/** tokens.css as { selector: { property: value } }; a rule with several selectors is listed under each. */
function readTokens(): Map<string, Record<string, string>> {
  const css = readFileSync(new URL("../src/ui/theme/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = new Map<string, Record<string, string>>();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const declarations = Object.fromEntries(
      body!
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
    );
    for (const selector of selectors!.split(",").map((s) => s.trim())) rules.set(selector, { ...rules.get(selector), ...declarations });
  }
  return rules;
}

const tokens = readTokens();
const themeRule = (key: string) => tokens.get(`[data-theme="${key}"]`)!;
const accentRule = (key: string) => tokens.get(`[data-accent="${key}"]`)!;
const color = (hex: string): Rgba => {
  const c = parseColor(hex);
  if (!c) throw new Error(`not a color: ${hex}`);
  return c;
};
/** --accent-soft over `ground`: the accent (without its opacity) at the family's share. */
const tint = (ground: string, accent: string, family: Family): Rgba => mix(color(ground), { ...color(accent), a: 1 }, ACCENT_SOFT[family]);

describe("hex colors", () => {
  it("reads #rgb, #rgba, #rrggbb and #rrggbbaa, with or without #, and nothing else", () => {
    expect(parseColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
    expect(parseColor(" ABC8 ")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 0x88 / 255 });
    expect(parseColor("#C6F432")).toEqual({ r: 198, g: 244, b: 50, a: 1 });
    expect(parseColor("c6f43280")).toEqual({ r: 198, g: 244, b: 50, a: 128 / 255 });
    for (const bad of ["", "#", "#ab", "#abcde", "#abcdefg", "#ggg", "red", "rgb(0,0,0)"]) expect(parseColor(bad)).toBeNull();
  });

  it("writes lowercase #rrggbb, with alpha digits only when see-through", () => {
    expect(formatColor({ r: 198, g: 244, b: 50, a: 1 })).toBe("#c6f432");
    expect(formatColor({ r: 198, g: 244, b: 50, a: 0.5 })).toBe("#c6f43280");
    expect(formatColor({ r: -4, g: 300, b: 127.6, a: 2 })).toBe("#00ff80");
    for (const hex of ["#000000", "#ffffff", "#12345678", "#c6f432"]) expect(formatColor(color(hex))).toBe(hex);
  });

  it("goes to hue / saturation / brightness and back", () => {
    expect(toHsva(color("#ff0000"))).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(toHsva(color("#00ff00"))).toMatchObject({ h: 120, s: 1, v: 1 });
    expect(toHsva(color("#808080"), 200)).toMatchObject({ h: 200, s: 0 }); // grays keep the hue they had
    for (const hex of ["#c6f432", "#7db7ff", "#0e131b", "#f3ecde", "#a3336180", "#000000", "#ffffff"]) {
      expect(formatColor(fromHsva(toHsva(color(hex))))).toBe(hex);
    }
  });

  it("measures contrast like WCAG", () => {
    expect(contrast(color("#000"), color("#fff"))).toBeCloseTo(21, 5);
    expect(contrast(color("#777"), color("#777"))).toBe(1);
    expect(luminance(color("#fff"))).toBeCloseTo(1, 5);
  });
});

describe("tokens.css themes", () => {
  it("lists every theme with the same tokens (the ones a Custom theme sets)", () => {
    for (const t of THEMES) expect(Object.keys(themeRule(t.key)).sort(), t.key).toEqual([...THEME_TOKENS].sort());
    // OLED is also the default on <html>.
    expect(tokens.get(":root")).toMatchObject(themeRule("oled"));
  });

  it("keeps THEME_GROUNDS (and THEME_BG, the browser bar's color) in step with each theme's tokens", () => {
    for (const t of THEMES) {
      const rule = themeRule(t.key);
      expect(THEME_GROUNDS[t.key], t.key).toEqual({
        bg: rule["--bg"],
        panel: rule["--panel"],
        surface: rule["--surface"],
        surfaceRaised: rule["--surface-raised"],
        tile: rule["--tile"],
      });
      expect(THEME_BG[t.key], t.key).toBe(rule["--bg"]);
    }
  });

  it("keeps text readable on every theme's background, panels, surfaces and tiles: 7:1, 4.5:1 and 3:1", () => {
    for (const t of THEMES) {
      const rule = themeRule(t.key);
      for (const ground of ["--bg", "--panel", "--tile", "--surface", "--surface-raised"]) {
        const g = color(rule[ground]!);
        expect(contrast(color(rule["--text"]!), g), `${t.key} text on ${ground}`).toBeGreaterThanOrEqual(7);
        expect(contrast(color(rule["--text-2"]!), g), `${t.key} text-2 on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color(rule["--text-3"]!), g), `${t.key} text-3 on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("puts each theme in the family its background belongs to", () => {
    for (const t of THEMES) expect(familyOfColor(color(themeRule(t.key)["--bg"]!)), t.key).toBe(t.family);
  });
});

describe("tokens.css accents", () => {
  const presets = ACCENTS.filter((a) => a.key !== "ink");
  const grounds = (family: Family) =>
    THEMES.filter((t) => t.family === family).flatMap((t) =>
      ["--bg", "--panel", "--tile", "--surface", "--surface-raised"].map((g) => [`${t.key} ${g}`, themeRule(t.key)[g]!] as const),
    );

  it("gives every accent a fill and a text color for each family; Ink uses the theme's text and background", () => {
    // (a preset never sets --accent-text-*: its fills already read as text, so the text color is the fill)
    // (nor --accent-solid-*: only a see-through Custom accent has a fill that differs from it)
    for (const a of ACCENTS) {
      expect(Object.keys(accentRule(a.key)).sort(), a.key).toEqual(ACCENT_TOKENS.filter((t) => !t.startsWith("--accent-text") && !t.startsWith("--accent-solid")).sort());
    }
    expect(Object.values(accentRule("ink"))).toEqual(["initial", "initial", "initial", "initial"]);
    expect(tokens.get(":root")).toMatchObject(accentRule("lime"));
    // Lime and Blue keep the dark fills OLED and Graphite always had.
    expect(accentRule("lime")["--accent-d"]).toBe("#c6f432");
    expect(accentRule("blue")["--accent-d"]).toBe("#7db7ff");
  });

  it("keeps ACCENT_FILLS (what look.ts adjusts on a Custom theme) in step with tokens.css", () => {
    for (const a of presets) {
      const rule = accentRule(a.key);
      expect(ACCENT_FILLS[a.key as keyof typeof ACCENT_FILLS], a.key).toEqual({ light: rule["--accent-l"], dark: rule["--accent-d"] });
    }
  });

  it("reads text on each fill at 4.5:1 or better", () => {
    for (const a of presets) {
      const rule = accentRule(a.key);
      expect(contrast(color(rule["--accent-ink-l"]!), color(rule["--accent-l"]!)), `${a.key} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(rule["--accent-ink-d"]!), color(rule["--accent-d"]!)), `${a.key} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reads each fill as text at 4.5:1 or better on its family's backgrounds, panels, surfaces and tiles", () => {
    for (const a of presets) {
      const rule = accentRule(a.key);
      for (const [name, ground] of grounds("light")) expect(contrast(color(rule["--accent-l"]!), color(ground)), `${a.key} on ${name}`).toBeGreaterThanOrEqual(4.5);
      for (const [name, ground] of grounds("dark")) expect(contrast(color(rule["--accent-d"]!), color(ground)), `${a.key} on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("works the accent out per family, falling back to the text color (Ink)", () => {
    expect(tokens.get('[data-family="dark"]')).toMatchObject({ "color-scheme": "dark", "--accent": "var(--accent-d, var(--text))", "--accent-ink": "var(--accent-ink-d, var(--bg))" });
    expect(tokens.get('[data-family="light"]')).toMatchObject({ "color-scheme": "light", "--accent": "var(--accent-l, var(--text))", "--accent-ink": "var(--accent-ink-l, var(--bg))" });
    for (const family of ["dark", "light"]) {
      expect(Object.keys(tokens.get(`[data-family="${family}"]`)!)).toEqual(expect.arrayContaining(["--accent-soft", "--accent-line"]));
    }
  });

  it("makes the tint and lines from the accent without a see-through part, at ACCENT_SOFT's share", () => {
    for (const family of ["dark", "light"] as const) {
      const x = family === "light" ? "l" : "d";
      const rule = tokens.get(`[data-family="${family}"]`)!;
      expect(rule["--accent-solid"]).toBe(`var(--accent-solid-${x}, var(--accent))`);
      expect(rule["--accent-soft"]).toBe(`color-mix(in srgb, var(--accent-solid) ${Math.round(ACCENT_SOFT[family] * 100)}%, transparent)`);
      expect(rule["--accent-line"]).toBe("color-mix(in srgb, var(--accent-solid) 35%, var(--tile-line))");
    }
  });

  it("reads each fill as text at 4.5:1 on its own tint over every tile of its family (the picked day, the past-day banner)", () => {
    for (const a of presets) {
      const rule = accentRule(a.key);
      for (const t of THEMES) {
        const fill = rule[t.family === "light" ? "--accent-l" : "--accent-d"]!;
        const ground = tint(themeRule(t.key)["--tile"]!, fill, t.family);
        expect(contrast(color(fill), ground), `${a.key} on ${t.key}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps --text at 4.5:1 and --text-2 at 3:1 on the accent's tint over a tile, Ink included", () => {
    for (const t of THEMES) {
      const rule = themeRule(t.key);
      for (const fill of [...Object.values(ACCENT_FILLS).map((f) => f[t.family]), rule["--text"]!]) {
        const ground = tint(rule["--tile"]!, fill, t.family);
        expect(contrast(color(rule["--text"]!), ground), `${t.key} text on ${fill}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color(rule["--text-2"]!), ground), `${t.key} text-2 on ${fill}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("tokens.css status and chart colors", () => {
  const MARKS = ["--good", ...Array.from({ length: 8 }, (_, i) => `--series-${i + 1}`)];
  const lightRule = tokens.get('[data-family="light"]')!;
  const value = (family: Family, name: string) => (family === "light" ? lightRule[name] : undefined) ?? tokens.get(":root")![name]!;
  const grounds = (family: Family) =>
    THEMES.filter((t) => t.family === family).flatMap((t) => ["--bg", "--panel", "--surface", "--tile"].map((g) => [`${t.key} ${g}`, themeRule(t.key)[g]!] as const));

  it("reads dots, check marks and chart lines at 3:1 on every theme's page, panels, surfaces and tiles", () => {
    for (const family of ["light", "dark"] as const)
      for (const name of [...MARKS, "--bad"])
        for (const [where, ground] of grounds(family)) {
          expect(contrast(color(value(family, name)), color(ground)), `${name} on ${where}`).toBeGreaterThanOrEqual(3);
        }
  });

  it("reads --bad as text (errors, Delete) at 4.5:1 on every theme's page, panels, surfaces and tiles", () => {
    for (const family of ["light", "dark"] as const)
      for (const [where, ground] of grounds(family)) expect(contrast(color(value(family, "--bad")), color(ground)), where).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps MARK_COLORS (what a Custom theme starts from) in step with tokens.css", () => {
    for (const family of ["light", "dark"] as const) {
      expect(Object.keys(MARK_COLORS[family]).sort()).toEqual([...MARK_TOKENS].sort());
      for (const name of MARK_TOKENS) expect(MARK_COLORS[family][name], `${family} ${name}`).toBe(value(family, name));
    }
  });

  it("gives light themes the same hues, only deeper, so an exercise keeps its color", () => {
    for (const name of [...MARKS, "--bad"]) {
      const [dark, light] = [color(value("dark", name)), color(value("light", name))];
      expect(lightRule[name], name).toBeDefined();
      expect(Math.abs(toHsva(light).h - toHsva(dark).h), name).toBeLessThan(2);
      expect(luminance(light), name).toBeLessThan(luminance(dark));
    }
    expect(value("light", "--series-6")).toBe(value("light", "--good")); // as in dark themes
  });
});

describe("a Custom theme", () => {
  /** A spread of colors: hues around the wheel at several saturations, brightnesses and opacities. */
  const sweep: string[] = [];
  for (let h = 0; h < 360; h += 30)
    for (const s of [0, 0.3, 0.7, 1])
      for (const v of [0, 0.08, 0.2, 0.4, 0.6, 0.8, 0.95, 1]) for (const a of [1, 0.6, 0.15]) sweep.push(formatColor(fromHsva({ h, s, v, a })));

  it("sets every theme token and the status and chart colors, as colors that parse (row sizes aside)", () => {
    const { tokens: t } = customThemeTokens("#1e2a44");
    expect(Object.keys(t).sort()).toEqual([...THEME_TOKENS, ...MARK_TOKENS].sort());
    for (const name of [...THEME_TOKENS, ...MARK_TOKENS].filter((n) => !["--row-radius", "--row-gap", "--row-pad-x", "--row-divider"].includes(n))) {
      expect(parseColor(t[name as keyof typeof t]), name).not.toBeNull();
    }
    // LookSync clears them all when the next look is a preset.
    for (const name of Object.keys(t)) expect(LOOK_TOKENS).toContain(name);
  });

  const MARK_GROUNDS = ["--bg", "--panel", "--surface", "--tile"] as const;

  it("shows dots, check marks and chart lines at 3:1 and --bad as text at 4.5:1 on its page, panels, surfaces and tiles, whatever the color", () => {
    for (const picked of [...sweep, "#5a2e18", "#8a8a8a", "#e3d3f2"]) {
      const { tokens: t } = customThemeTokens(picked);
      for (const name of MARK_TOKENS)
        for (const ground of MARK_GROUNDS) {
          const ratio = contrast(color(t[name]), color(t[ground]));
          expect(ratio, `${picked} ${name} on ${ground}`).toBeGreaterThanOrEqual(name === "--bad" ? 4.5 : 3);
        }
    }
  });

  it("keeps --text at 4.5:1 and --text-2 at 3:1 on an accent's tint over its tile (the past-day banner, the picked day)", () => {
    for (const picked of sweep.filter((_, i) => i % 3 === 0)) {
      const { family, tokens: t } = customThemeTokens(picked);
      for (const fill of [...Object.values(ACCENT_FILLS).map((f) => f[family]), t["--text"], "#ffd60a", "#3f6a0a", "#ff00ff", "#3d7bff"]) {
        const ground = tint(t["--tile"], fill, family);
        expect(contrast(color(t["--text"]), ground), `${picked} text on ${fill}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color(t["--text-2"]), ground), `${picked} text-2 on ${fill}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the family's status and chart colors where they show, and moves the rest only as far as they must, keeping their hue", () => {
    // Black and pale cream: the presets' colors already show.
    expect(customThemeTokens("#000000").tokens).toMatchObject(MARK_COLORS.dark);
    expect(customThemeTokens("#fff3d6").tokens).toMatchObject(MARK_COLORS.light);
    // Deep navy: its tiles are a little lighter than Midnight's, so only red and the gray move, a little.
    const navy = customThemeTokens("#0b1a2e").tokens;
    expect(MARK_TOKENS.filter((name) => navy[name] !== MARK_COLORS.dark[name])).toEqual(["--bad", "--series-other"]);
    // Mid brown (dark): lightened. Mid gray (light): deepened. Same hues as the family's.
    for (const [picked, family] of [
      ["#5a2e18", "dark"],
      ["#8a8a8a", "light"],
    ] as const) {
      const { family: f, tokens: t } = customThemeTokens(picked);
      expect(f).toBe(family);
      let moved = 0;
      for (const name of MARK_TOKENS) {
        const [from, to] = [color(MARK_COLORS[family][name]), color(t[name])];
        if (t[name] === MARK_COLORS[family][name]) continue;
        moved++;
        if (family === "dark") expect(luminance(to), `${picked} ${name}`).toBeGreaterThan(luminance(from));
        else expect(luminance(to), `${picked} ${name}`).toBeLessThan(luminance(from));
        if (toHsva(from).s > 0.2 && toHsva(to).s > 0.2) expect(Math.abs(((toHsva(from).h - toHsva(to).h + 540) % 360) - 180), `${picked} ${name}`).toBeLessThan(4);
        // Not further than it must: a step back toward the family's color wouldn't show.
        const back = mix(to, from, 0.05);
        const ratio = name === "--bad" ? 4.5 : 3;
        expect(Math.min(...MARK_GROUNDS.map((g) => contrast(back, color(t[g])))), `${picked} ${name}`).toBeLessThan(ratio + 0.15);
      }
      expect(moved, picked).toBeGreaterThan(5);
    }
  });

  const GROUNDS = ["--bg", "--panel", "--surface", "--surface-raised", "--tile"] as const;

  it("keeps text at 7:1, 4.5:1 and 3:1 on its background, panels, surfaces and tiles, whatever the color", () => {
    for (const picked of sweep) {
      const { tokens: t } = customThemeTokens(picked);
      for (const ground of GROUNDS) {
        const g = color(t[ground]);
        expect(contrast(color(t["--text"]), g), `${picked} text on ${ground}`).toBeGreaterThanOrEqual(7);
        expect(contrast(color(t["--text-2"]), g), `${picked} text-2 on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color(t["--text-3"]), g), `${picked} text-3 on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("takes its family from the color, steps tiles and lines away from the background, and keeps the background opaque", () => {
    for (const picked of sweep) {
      const { family, tokens: t } = customThemeTokens(picked);
      expect(family).toBe(familyOfColor(color(picked)));
      expect(color(t["--bg"]).a).toBe(1);
      const bg = luminance(color(t["--bg"]));
      if (family === "dark") {
        expect(luminance(color(t["--tile"])), picked).toBeGreaterThan(bg - 1e-9);
        expect(luminance(color(t["--hairline"])), picked).toBeGreaterThan(bg);
      } else {
        expect(luminance(color(t["--panel"])), picked).toBeLessThan(bg);
        expect(luminance(color(t["--hairline"])), picked).toBeLessThan(bg);
      }
    }
  });

  it("shows a color as picked whenever text can reach 7:1 on it, vivid ones included", () => {
    expect(customThemeTokens("#0b1a2e")).toMatchObject({ family: "dark", tokens: { "--bg": "#0b1a2e" } });
    expect(customThemeTokens("#fff3d6")).toMatchObject({ family: "light", tokens: { "--bg": "#fff3d6" } });
    expect(customThemeTokens("#ffffff").tokens["--bg"]).toBe("#ffffff");
    expect(customThemeTokens("#000000").tokens["--bg"]).toBe("#000000");
    // Black text already reads at 7:1 or more on these: no pastel.
    for (const vivid of ["#ff8000", "#48a5f3", "#f59912", "#ffd60a", "#4fd1c5"]) expect(customThemeTokens(vivid).tokens["--bg"], vivid).toBe(vivid);
  });

  it("moves a hard color only as far as text needs, keeping its hue", () => {
    // Plain white or black text, the furthest a text color goes, on every ground.
    const worst = (t: Record<string, string>, family: Family) =>
      Math.min(...GROUNDS.map((g) => contrast(color(family === "dark" ? "#ffffff" : "#000000"), color(t[g]!))));
    let moved = 0;
    for (const picked of sweep) {
      const { family, tokens: t } = customThemeTokens(picked);
      const blended = formatColor(over(color(picked), color(family === "dark" ? "#000000" : "#ffffff")));
      if (t["--bg"] === blended) continue;
      moved++;
      expect(worst(t, family), picked).toBeLessThan(7.3); // just past 7:1, not further
      const [from, to] = [toHsva(color(blended)), toHsva(color(t["--bg"]))];
      if (from.s > 0.2 && to.s > 0.2) expect(Math.abs(((from.h - to.h + 540) % 360) - 180), picked).toBeLessThan(4);
    }
    expect(moved).toBeGreaterThan(50);
    // Mid blue is too light for white text at 7:1: darkened. Pure red can't hold 7:1 either way: lightened.
    expect(luminance(color(customThemeTokens("#3b6fd4").tokens["--bg"]))).toBeLessThan(luminance(color("#3b6fd4")));
    expect(luminance(color(customThemeTokens("#ff0000").tokens["--bg"]))).toBeGreaterThan(luminance(color("#ff0000")));
  });

  it("blends a see-through color with its family's base: black for dark, white for light", () => {
    expect(customThemeTokens("#0b1a2e00").tokens["--bg"]).toBe("#000000");
    expect(customThemeTokens("#fff3d600").tokens["--bg"]).toBe("#ffffff");
    const half = color(customThemeTokens("#0b1a2e80").tokens["--bg"]);
    expect(luminance(half)).toBeLessThan(luminance(color("#0b1a2e")));
    expect(luminance(color(customThemeTokens("#fff3d680").tokens["--bg"]))).toBeGreaterThan(luminance(color("#fff3d6")));
  });
});

describe("the resolved look", () => {
  const base = { theme: "oled", customThemeColor: null, accent: "lime", customAccentColor: null } as const;
  /** A Custom theme's grounds, from the tokens it sets. */
  const GROUNDS_OF = (look: Look) => ["--bg", "--panel", "--surface", "--surface-raised", "--tile"].map((g) => look.vars[g]!);

  it("is plain ids for presets: tokens.css does the rest", () => {
    expect(resolveLook({ ...base, theme: "sand", accent: "teal" })).toEqual({ theme: "sand", accent: "teal", family: "light", bg: "#f3ecde", vars: {} });
    expect(resolveLook(base)).toEqual({ theme: "oled", accent: "lime", family: "dark", bg: "#000000", vars: {} });
  });

  it("carries a Custom theme's tokens and background", () => {
    const look = resolveLook({ ...base, theme: "custom", customThemeColor: "#fff3d6" });
    expect(look).toMatchObject({ theme: "custom", family: "light", bg: "#fff3d6" });
    expect(look.vars).toEqual(customThemeTokens("#fff3d6").tokens);
  });

  it("keeps a Custom accent exactly as picked for fills, with black or white text on it, and moves only its text color where it wouldn't read", () => {
    // Bright yellow: the fill is the pick in both families; as text it reads on dark themes as it
    // is, and is deepened (same hue) for light ones, like Amber's two fills.
    const yellow = resolveLook({ ...base, accent: "custom", customAccentColor: "#ffd60a" });
    expect(yellow.vars).toMatchObject({ "--accent-d": "#ffd60a", "--accent-l": "#ffd60a", "--accent-ink-d": "#000000", "--accent-ink-l": "#000000" });
    expect(yellow.vars["--accent-text-d"]).toBeUndefined();
    const deep = color(yellow.vars["--accent-text-l"]!);
    expect(luminance(deep)).toBeLessThan(luminance(color("#ffd60a")));
    expect(toHsva(deep).h).toBeCloseTo(toHsva(color("#ffd60a")).h, 0);
    // A deep olive: the fill stays olive on dark themes too; only its text color is lightened there.
    const olive = resolveLook({ ...base, accent: "custom", customAccentColor: "#3f6a0a" });
    expect(olive.vars).toMatchObject({ "--accent-l": "#3f6a0a", "--accent-d": "#3f6a0a" });
    expect(olive.vars["--accent-text-l"]).toBeUndefined();
    expect(luminance(color(olive.vars["--accent-text-d"]!))).toBeGreaterThan(luminance(color("#3f6a0a")));
    // Faint yellow keeps its opacity as a fill; over black it looks dark, so white text on it. Its
    // text color is opaque.
    const faint = resolveLook({ ...base, accent: "custom", customAccentColor: "#ffd60a33" });
    expect(faint.vars["--accent-d"]).toBe("#ffd60a33");
    expect(faint.vars["--accent-ink-d"]).toBe("#ffffff");
    expect(color(faint.vars["--accent-text-d"]!).a).toBe(1);
    // Its tint, lines and focus borders are made from the color without its opacity, so the
    // picked choice and the current tab still show; an opaque accent needs none of that.
    expect(faint.vars).toMatchObject({ "--accent-solid-d": "#ffd60a", "--accent-solid-l": "#ffd60a" });
    expect(Object.keys(yellow.vars).filter((k) => k.startsWith("--accent-solid"))).toEqual([]);
    expect(accentFillToken("light")).toBe("--accent-l");
    expect(accentFillToken("dark")).toBe("--accent-d");
  });

  it("reads a Custom accent as text at 4.5:1 on every theme of each family, Custom themes included", () => {
    const presetGrounds = (family: Family) => THEMES.filter((t) => t.family === family).flatMap((t) => Object.values(THEME_GROUNDS[t.key]));
    for (let h = 0; h < 360; h += 30)
      for (const v of [0.15, 0.45, 0.75, 1])
        for (const theme of ["#ff8000", "#f3ecde", "#123456", "#2b2b2b", "#e3d3f2", null]) {
          const accent = formatColor(fromHsva({ h, s: 0.8, v, a: 1 }));
          const look = resolveLook({ ...base, theme: theme ? "custom" : "oled", customThemeColor: theme, accent: "custom", customAccentColor: accent });
          for (const family of ["light", "dark"] as const) {
            const grounds = theme && look.family === family ? GROUNDS_OF(look) : presetGrounds(family);
            const x = family === "light" ? "l" : "d";
            const fill = color(look.vars[accentFillToken(family)]!);
            expect(look.vars[accentFillToken(family)]).toBe(accent); // the fill is the pick
            const text = color(look.vars[`--accent-text-${x}`] ?? look.vars[accentFillToken(family)]!);
            for (const g of grounds) expect(contrast(text, color(g)), `${accent} on ${theme ?? "presets"} (${family})`).toBeGreaterThanOrEqual(4.5);
            // Also on its tint over a tile (today on the picked day, the past-day banner's link).
            const tiles = theme && look.family === family ? [look.vars["--tile"]!] : THEMES.filter((t) => t.family === family).map((t) => THEME_GROUNDS[t.key].tile);
            for (const tile of tiles) expect(contrast(text, tint(tile, accent, family)), `${accent} on its tint, ${theme ?? "presets"} (${family})`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(color(look.vars[`--accent-ink-${x}`]!), fill)).toBeGreaterThanOrEqual(4.5);
          }
        }
  });

  it("keeps a preset accent on a Custom theme, moving only its text color where it wouldn't read", () => {
    for (const theme of ["#ff8000", "#48a5f3", "#fff3d6", "#123456", "#3b6fd4", "#2b2b2b", "#e3d3f2", "#5a2e18", "#8a8a8a"])
      for (const accent of Object.keys(ACCENT_FILLS) as (keyof typeof ACCENT_FILLS)[]) {
        const look = resolveLook({ ...base, theme: "custom", customThemeColor: theme, accent });
        const textToken = `--accent-text-${look.family === "light" ? "l" : "d"}`;
        const text = look.vars[textToken] ?? ACCENT_FILLS[accent][look.family];
        for (const g of GROUNDS_OF(look)) expect(contrast(color(text), color(g)), `${accent} on ${theme}`).toBeGreaterThanOrEqual(4.5);
        const onTint = contrast(color(text), tint(look.vars["--tile"]!, ACCENT_FILLS[accent][look.family], look.family));
        expect(onTint, `${accent} on its tint, ${theme}`).toBeGreaterThanOrEqual(4.5);
        // The fill and its text stay tokens.css's; only this family's text color may be set.
        expect(Object.keys(look.vars).filter((k) => k.startsWith("--accent"))).toEqual(look.vars[textToken] ? [textToken] : []);
      }
    // Pale cream: Lime's light fill already reads, so nothing about the accent is set.
    expect(Object.keys(resolveLook({ ...base, theme: "custom", customThemeColor: "#fff3d6", accent: "lime" }).vars).filter((k) => k.startsWith("--accent"))).toEqual([]);
  });

  it("moves a fill only as far as it must, and leaves one that reads alone", () => {
    const black = [color("#000000")];
    expect(readableAccent(color("#c6f432"), "dark", black)).toEqual(color("#c6f432"));
    const lifted = readableAccent(color("#1d3b8f80"), "dark", black);
    expect(lifted.a).toBeCloseTo(0x80 / 255, 5);
    const ratio = contrast({ ...lifted, a: 1 }, black[0]!);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.7);
  });

  it("always finds text at 4.5:1 or better on a custom accent", () => {
    for (let h = 0; h < 360; h += 20)
      for (const v of [0.2, 0.5, 0.8, 1])
        for (const a of [1, 0.5, 0.2]) {
          const fill = fromHsva({ h, s: 0.8, v, a });
          for (const behind of [color("#000000"), color("#f5f4f0")]) {
            expect(contrast(color(inkOn(fill, behind)), over(fill, behind))).toBeGreaterThanOrEqual(4.5);
          }
        }
  });
});

/** Just enough DOM for applyLook and index.html's head script. */
function fakePage(saved: Record<string, string> = {}) {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const metas = new Map([
    ["theme-color", "#000000"],
    ["color-scheme", "dark"],
  ]);
  const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const documentElement = {
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    dataset: new Proxy({} as Record<string, string>, {
      set: (_target, key, value: string) => (attributes.set(`data-${kebab(String(key))}`, value), true),
    }),
    style: {
      setProperty: (name: string, value: string) => void properties.set(name, value),
      removeProperty: (name: string) => void properties.delete(name),
    },
  };
  const document = {
    documentElement,
    querySelector: (selector: string) => {
      const name = /meta\[name="([^"]+)"\]/.exec(selector)?.[1];
      return name && metas.has(name) ? { setAttribute: (_attr: string, value: string) => void metas.set(name, value) } : null;
    },
  };
  const localStorage = { getItem: (key: string) => saved[key] ?? null };
  return { document, localStorage, attributes, properties, metas };
}

/** index.html's inline head script, run on a fake page. */
function runHeadScript(page: ReturnType<typeof fakePage>): void {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error("no head script in index.html");
  new Function("document", "localStorage", script)(page.document, page.localStorage);
}

describe("the first frame (index.html's head script)", () => {
  const looks: Look[] = [
    resolveLook({ theme: "mist", customThemeColor: null, accent: "purple", customAccentColor: null }),
    resolveLook({ theme: "custom", customThemeColor: "#2a1f3d", accent: "custom", customAccentColor: "#4fd1c5cc" }),
    resolveLook({ theme: "custom", customThemeColor: "#fff3d6", accent: "ink", customAccentColor: null }),
  ];

  it("paints the saved look exactly as LookSync does", () => {
    for (const look of looks) {
      const early = fakePage({ [LOOK_KEY]: JSON.stringify(look) });
      runHeadScript(early);
      const app = fakePage();
      applyLook(app.document as unknown as Document, look);
      expect(early.attributes).toEqual(app.attributes);
      expect(early.properties).toEqual(app.properties);
      expect(early.metas).toEqual(app.metas);
      expect(early.metas.get("theme-color")).toBe(look.bg);
    }
  });

  it("shows Graphite with its blue on the first open after an update from before accents", () => {
    const page = fakePage({ "gym-tracker.settings": JSON.stringify({ theme: "graphite", showLastSession: true }) });
    runHeadScript(page);
    expect(Object.fromEntries(page.attributes)).toEqual({ "data-theme": "graphite", "data-accent": "blue", "data-family": "dark" });
    expect(page.metas.get("theme-color")).toBe(THEME_BG.graphite);
  });

  it("leaves the defaults (OLED, Lime) when nothing usable is saved", () => {
    const copies: Record<string, string>[] = [{}, { [LOOK_KEY]: "{not json" }, { [LOOK_KEY]: "42" }, { "gym-tracker.settings": JSON.stringify({ theme: "oled" }) }];
    for (const saved of copies) {
      const page = fakePage(saved);
      expect(() => runHeadScript(page)).not.toThrow();
      expect(page.attributes.size).toBe(0);
      expect(page.properties.size).toBe(0);
    }
  });

  it("sets only custom properties from a saved copy", () => {
    const page = fakePage({ [LOOK_KEY]: JSON.stringify({ theme: "oled", accent: "lime", family: "dark", bg: "#000000", vars: { color: "red", "--bg": "#101010", "--x": 5 } }) });
    runHeadScript(page);
    expect(Object.fromEntries(page.properties)).toEqual({ "--bg": "#101010" });
  });

  it("clears a Custom look's properties when the next look is a preset", () => {
    const page = fakePage();
    applyLook(page.document as unknown as Document, looks[1]!);
    expect(page.properties.size).toBeGreaterThan(0);
    applyLook(page.document as unknown as Document, looks[0]!);
    expect(page.properties.size).toBe(0);
    expect(page.attributes.get("data-family")).toBe("light");
  });
});
