import { useCallback, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ACCENTS, THEMES, withRecentColor, type Settings } from "../../../services/SettingsService";
import { Toggle } from "../../components/controls";
import { previewLook } from "../../LookSync";
import { useServices, useSettings } from "../../ServicesContext";
import { customThemeTokens, formatColor, parseColor, resolveLook } from "../../theme/look";
import { ColorPicker } from "./ColorPicker";

type Paint = CSSProperties & Record<`--${string}`, string>;
type Picking = "theme" | "accent" | null;

/**
 * Settings → Appearance: the accent color (a row of swatches) and the theme (tiles that each
 * preview their own background, card and accent), each with Custom, which opens the color
 * picker. Picks are settings, so they sync to the account like the rest (TASKS.md D20).
 *
 * Swatches and previews carry their own data-accent / data-theme / data-family, so tokens.css
 * colors each one as itself: no colors here, except a Custom color the user picked.
 */
export function LookSettings() {
  const { settings } = useServices();
  const current = useSettings();
  const [picking, setPicking] = useState<Picking>(null);
  const look = resolveLook(current);

  const accentName = current.accent === "custom" ? "Custom" : (ACCENTS.find((a) => a.key === current.accent)?.label ?? "");
  const themeName = current.theme === "custom" ? "Custom" : (THEMES.find((t) => t.key === current.theme)?.label ?? "");
  const custom = current.customThemeColor ? customThemeTokens(current.customThemeColor) : null;

  const preview = useCallback(
    (color: string) =>
      previewLook(picking === "theme" ? { theme: "custom", customThemeColor: color } : { accent: "custom", customAccentColor: color }),
    [picking],
  );
  const close = useCallback(() => {
    previewLook(null);
    setPicking(null);
  }, []);
  const done = (color: string) => {
    // One update: the color, Custom picked, and the color at the front of the recent list.
    const changes: Partial<Settings> =
      picking === "theme"
        ? { theme: "custom", customThemeColor: color, recentThemeColors: withRecentColor(current.recentThemeColors, color) }
        : { accent: "custom", customAccentColor: color, recentAccentColors: withRecentColor(current.recentAccentColors, color) };
    settings.update(changes);
    close();
  };

  return (
    <div className="card look">
      <div className="look-group">
        <div className="look-head">
          <h3 className="look-title" id="look-accent">
            Accent color
          </h3>
          <span className="look-value" aria-hidden="true">
            {accentName}
          </span>
        </div>
        <div className="accent-grid" role="radiogroup" aria-labelledby="look-accent">
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              role="radio"
              className="accent-choice"
              data-accent={a.key}
              aria-checked={current.accent === a.key}
              aria-label={a.label}
              title={a.label}
              onClick={() => settings.update({ accent: a.key })}
            >
              <span className="accent-dot" />
            </button>
          ))}
          <button
            type="button"
            role="radio"
            className={`accent-choice is-custom${current.customAccentColor ? " is-set" : ""}`}
            aria-checked={current.accent === "custom"}
            aria-haspopup="dialog"
            aria-label="Custom accent color"
            title="Custom"
            onClick={() => setPicking("accent")}
          >
            <span className="accent-dot" style={current.customAccentColor ? ({ "--swatch": current.customAccentColor } as Paint) : undefined} />
          </button>
        </div>
      </div>

      <div className="look-group">
        <div className="look-head">
          <h3 className="look-title" id="look-theme">
            Theme
          </h3>
          <span className="look-value" aria-hidden="true">
            {themeName}
          </span>
        </div>
        <div className="theme-grid" role="radiogroup" aria-labelledby="look-theme">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              className="theme-choice"
              aria-checked={current.theme === t.key}
              onClick={() => settings.update({ theme: t.key })}
            >
              <span className="theme-mini" data-theme={t.key} data-family={t.family} aria-hidden="true">
                <i />
              </span>
              <span className="theme-name">{t.label}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            className={`theme-choice is-custom${custom ? " is-set" : ""}`}
            aria-checked={current.theme === "custom"}
            aria-haspopup="dialog"
            aria-label="Custom theme"
            onClick={() => setPicking("theme")}
          >
            <span
              className="theme-mini"
              data-theme="custom"
              data-family={custom?.family ?? look.family}
              style={custom ? (custom.tokens as Paint) : undefined}
              aria-hidden="true"
            >
              <i />
            </span>
            <span className="theme-name">Custom</span>
            <span className="theme-hint num" aria-hidden="true">
              {current.customThemeColor ? current.customThemeColor.slice(0, 7).toUpperCase() : "Any color"}
            </span>
          </button>
        </div>
      </div>

      <div className="look-group setting">
        <div className="text">
          <div>Show last session's numbers</div>
          <div className="desc">"last 130 · 8/8/7" under each exercise while logging</div>
        </div>
        <Toggle label="Show last session's numbers" checked={current.showLastSession} onChange={(v) => settings.update({ showLastSession: v })} />
      </div>

      {/* On <body>: a page animating with a transform would otherwise hold the fixed backdrop inside it. */}
      {picking &&
        createPortal(
          <ColorPicker
            title={picking === "theme" ? "Theme color" : "Accent color"}
            initial={picking === "theme" ? (current.customThemeColor ?? look.bg) : (current.customAccentColor ?? shownAccent(look.bg))}
            recent={picking === "theme" ? current.recentThemeColors : current.recentAccentColors}
            minAlpha={picking === "theme" ? 0 : 0.2}
            onPreview={preview}
            onDone={done}
            onCancel={close}
          />,
          document.body,
        )}
    </div>
  );
}

/** The accent on screen now (a preset's fill for this family), to start the picker from. */
function shownAccent(fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  const parsed = parseColor(value);
  return parsed ? formatColor(parsed) : fallback;
}
