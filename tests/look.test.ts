import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, THEMES, type Family } from "../src/services/SettingsService";
import { applyLook } from "../src/ui/LookSync";
import {
  ACCENT_TOKENS,
  contrast,
  customThemeTokens,
  familyOfColor,
  formatColor,
  fromHsva,
  inkOn,
  LOOK_KEY,
  luminance,
  over,
  parseColor,
  resolveLook,
  THEME_BG,
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

  it("keeps THEME_BG (the browser bar's color) in step with each theme's --bg", () => {
    for (const t of THEMES) expect(THEME_BG[t.key], t.key).toBe(themeRule(t.key)["--bg"]);
  });

  it("keeps text readable on every theme's background, panels and tiles: 7:1, 4.5:1 and 3:1", () => {
    for (const t of THEMES) {
      const rule = themeRule(t.key);
      for (const ground of ["--bg", "--panel", "--tile", "--surface"]) {
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
    THEMES.filter((t) => t.family === family).flatMap((t) => ["--bg", "--panel", "--tile"].map((g) => [`${t.key} ${g}`, themeRule(t.key)[g]!] as const));

  it("gives every accent a fill and a text color for each family; Ink uses the theme's text and background", () => {
    for (const a of ACCENTS) expect(Object.keys(accentRule(a.key)).sort(), a.key).toEqual([...ACCENT_TOKENS].sort());
    expect(Object.values(accentRule("ink"))).toEqual(["initial", "initial", "initial", "initial"]);
    expect(tokens.get(":root")).toMatchObject(accentRule("lime"));
    // Lime and Blue keep the dark fills OLED and Graphite always had.
    expect(accentRule("lime")["--accent-d"]).toBe("#c6f432");
    expect(accentRule("blue")["--accent-d"]).toBe("#7db7ff");
  });

  it("reads text on each fill at 4.5:1 or better", () => {
    for (const a of presets) {
      const rule = accentRule(a.key);
      expect(contrast(color(rule["--accent-ink-l"]!), color(rule["--accent-l"]!)), `${a.key} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(rule["--accent-ink-d"]!), color(rule["--accent-d"]!)), `${a.key} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reads each fill as text at 4.5:1 or better on its family's backgrounds, panels and tiles", () => {
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
});

describe("a Custom theme", () => {
  /** A spread of colors: hues around the wheel at several saturations, brightnesses and opacities. */
  const sweep: string[] = [];
  for (let h = 0; h < 360; h += 30)
    for (const s of [0, 0.3, 0.7, 1])
      for (const v of [0, 0.08, 0.2, 0.4, 0.6, 0.8, 0.95, 1]) for (const a of [1, 0.6, 0.15]) sweep.push(formatColor(fromHsva({ h, s, v, a })));

  it("sets every theme token, as colors that parse (row sizes aside)", () => {
    const { tokens: t } = customThemeTokens("#1e2a44");
    expect(Object.keys(t).sort()).toEqual([...THEME_TOKENS].sort());
    for (const name of THEME_TOKENS.filter((n) => !["--row-radius", "--row-gap", "--row-pad-x", "--row-divider"].includes(n))) {
      expect(parseColor(t[name]), name).not.toBeNull();
    }
  });

  it("keeps text at 7:1, 4.5:1 and 3:1 on its background, panels and tiles, whatever the color", () => {
    for (const picked of sweep) {
      const { tokens: t } = customThemeTokens(picked);
      for (const ground of ["--bg", "--panel", "--tile"] as const) {
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

  it("shows a readable color as picked, and moves a hard one only as far as text needs", () => {
    expect(customThemeTokens("#0b1a2e")).toMatchObject({ family: "dark", tokens: { "--bg": "#0b1a2e" } });
    expect(customThemeTokens("#fff3d6")).toMatchObject({ family: "light", tokens: { "--bg": "#fff3d6" } });
    expect(customThemeTokens("#ffffff").tokens["--bg"]).toBe("#ffffff");
    expect(customThemeTokens("#000000").tokens["--bg"]).toBe("#000000");
    // Mid blue is too light for white text at 7:1: darkened, same hue.
    const blue = color(customThemeTokens("#3b6fd4").tokens["--bg"]);
    expect(luminance(blue)).toBeLessThan(luminance(color("#3b6fd4")));
    expect(toHsva(blue).h).toBeCloseTo(toHsva(color("#3b6fd4")).h, -1);
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

  it("is plain ids for presets: tokens.css does the rest", () => {
    expect(resolveLook({ ...base, theme: "sand", accent: "teal" })).toEqual({ theme: "sand", accent: "teal", family: "light", bg: "#f3ecde", vars: {} });
    expect(resolveLook(base)).toEqual({ theme: "oled", accent: "lime", family: "dark", bg: "#000000", vars: {} });
  });

  it("carries a Custom theme's tokens and background", () => {
    const look = resolveLook({ ...base, theme: "custom", customThemeColor: "#fff3d6" });
    expect(look).toMatchObject({ theme: "custom", family: "light", bg: "#fff3d6" });
    expect(look.vars).toEqual(customThemeTokens("#fff3d6").tokens);
  });

  it("gives a Custom accent black or white text, whichever reads better on it over the background", () => {
    const light = resolveLook({ ...base, accent: "custom", customAccentColor: "#ffd60a" });
    expect(light.vars).toEqual({ "--accent-l": "#ffd60a", "--accent-d": "#ffd60a", "--accent-ink-l": "#000000", "--accent-ink-d": "#000000" });
    expect(resolveLook({ ...base, accent: "custom", customAccentColor: "#1d3b8f" }).vars["--accent-ink-d"]).toBe("#ffffff");
    // Faint yellow over black looks dark: white text.
    expect(resolveLook({ ...base, accent: "custom", customAccentColor: "#ffd60a33" }).vars["--accent-ink-d"]).toBe("#ffffff");
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
