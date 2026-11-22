import { EPOCH } from "../domain/ids";
import { Emitter, type Unsubscribe } from "../lib/Emitter";
import { systemClock, type Clock, type KeyValueStore, type PreferencesSnapshot, type SyncedPreferences } from "./ports";

/** A theme's family: light or dark surfaces. Sets the browser's color scheme and which fill each accent uses. */
export type Family = "light" | "dark";
export type ThemeId = "light" | "sand" | "mist" | "oled" | "graphite" | "midnight";
/** A preset theme, or "custom": a color the user picked (`customThemeColor`). */
export type ThemeName = ThemeId | "custom";
export type AccentId = "lime" | "ink" | "blue" | "teal" | "amber" | "orange" | "purple" | "pink";
/** A preset accent, or "custom": a color the user picked (`customAccentColor`). */
export type AccentName = AccentId | "custom";

/**
 * The themes: three light, three dark. They're neutral surfaces; the accent is its own setting.
 * Colors live in ui/theme/tokens.css. `oled` and `graphite` keep their ids (saved settings use them).
 */
export const THEMES: readonly { key: ThemeId; label: string; family: Family }[] = [
  { key: "light", label: "Light", family: "light" },
  { key: "sand", label: "Sand", family: "light" },
  { key: "mist", label: "Mist", family: "light" },
  { key: "oled", label: "OLED", family: "dark" },
  { key: "graphite", label: "Graphite", family: "dark" },
  { key: "midnight", label: "Midnight", family: "dark" },
];

/** Accent colors: buttons, borders, what's picked. Lime is the app's original; Ink is the text color. */
export const ACCENTS: readonly { key: AccentId; label: string }[] = [
  { key: "lime", label: "Lime" },
  { key: "ink", label: "Ink" },
  { key: "blue", label: "Blue" },
  { key: "teal", label: "Teal" },
  { key: "amber", label: "Amber" },
  { key: "orange", label: "Orange" },
  { key: "purple", label: "Purple" },
  { key: "pink", label: "Pink" },
];

/** How many custom colors each picker remembers. */
export const RECENT_COLORS = 5;

export interface Settings {
  theme: ThemeName;
  /** The Custom theme's color (`#rrggbb` or `#rrggbbaa`), once one was picked. */
  customThemeColor: string | null;
  accent: AccentName;
  /** The Custom accent's color, once one was picked. */
  customAccentColor: string | null;
  /** Custom theme colors picked lately, newest first (at most `RECENT_COLORS`). */
  recentThemeColors: string[];
  /** Custom accent colors picked lately, newest first. */
  recentAccentColors: string[];
  /** Show "last 130 · 8/8/7" under each exercise while logging. */
  showLastSession: boolean;
}

const DEFAULTS: Settings = {
  theme: "oled",
  customThemeColor: null,
  accent: "lime",
  customAccentColor: null,
  recentThemeColors: [],
  recentAccentColors: [],
  showLastSession: true,
};
const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];
const KEY = "gym-tracker.settings";

/**
 * Settings saved before they synced (no timestamp): older than any real change, so another
 * device's newer pick wins, but newer than untouched defaults, so a choice beats "never set".
 */
const PRE_SYNC_CHOICE = "1970-01-01T00:00:00.001Z";

/** The latest time a Date can hold. */
const LATEST_TIME = 8.64e15;

/** ISO time each setting last changed, here or on another device. */
type Stamps = Record<keyof Settings, string>;

interface Stored extends Partial<Settings> {
  /** The newest stamp. Copies saved before settings were stamped one by one have only this. */
  updatedAt?: string;
  stamps?: Partial<Stamps>;
}

/**
 * The user's preferences. Saved on this device right away and, when signed in, kept in step
 * with the account so the look follows you between phone and computer (TASKS.md D20).
 * Each setting carries its own stamp, so devices merge them one by one.
 * Add new options to `Settings`, `DEFAULTS`, and `sanitize`.
 *
 * An accent nobody ever picked (its stamp is still the epoch) shows the accent its theme had
 * before accents were a setting: Blue with Graphite, Lime otherwise. `get()` shows that;
 * `snapshot()` keeps the stored default, so every device holds the same untouched value.
 */
export class SettingsService implements SyncedPreferences {
  /** What's stored and synced. */
  private current: Settings;
  /** What's shown: `current` with an unpicked accent filled in from the theme. */
  private shown: Settings;
  private stamps: Stamps;
  private readonly emitter = new Emitter<Settings>();
  private readonly localChanges = new Emitter();

  constructor(
    private readonly store: KeyValueStore,
    private readonly clock: Clock = systemClock,
  ) {
    const saved = this.read();
    this.current = sanitize(saved);
    // A setting saved without its own stamp dates from the whole copy's time; one never saved
    // here (added in a later version) is still an untouched default.
    const savedAt = isoTime(saved.updatedAt) ?? PRE_SYNC_CHOICE;
    this.stamps = Object.fromEntries(
      SETTING_KEYS.map((k) => [k, isoTime(saved.stamps?.[k]) ?? (Object.hasOwn(saved, k) ? savedAt : EPOCH)]),
    ) as Stamps;
    this.shown = withShownAccent(this.current, this.stamps);
  }

  get(): Settings {
    return this.shown;
  }

  /**
   * Stamps only the settings in `changes`, so syncing them can't undo another device's newer
   * change to a different one. A theme change never swaps the accent on screen: while no
   * accent was picked, the one showing (Graphite's blue) is kept as a pick.
   */
  update(changes: Partial<Settings>): void {
    const now = this.clock.now();
    const changed = SETTING_KEYS.filter((k) => k in changes);
    let next = sanitize({ ...this.current, ...changes });
    if (!changed.includes("accent") && withShownAccent(next, this.stamps).accent !== this.shown.accent) {
      next = { ...next, accent: this.shown.accent };
      changed.push("accent");
    }
    this.current = next;
    this.stamps = { ...this.stamps, ...Object.fromEntries(changed.map((k) => [k, nextStamp(this.stamps[k], now)])) };
    this.save();
    this.localChanges.emit();
  }

  subscribe(listener: (s: Settings) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  snapshot(): PreferencesSnapshot {
    return { values: { ...this.current }, updatedAt: newest(this.stamps), stamps: { ...this.stamps } };
  }

  applyRemote(snapshot: PreferencesSnapshot): void {
    const listed = SETTING_KEYS.filter((k) => Object.hasOwn(snapshot.values, k));
    const copyAt = isoTime(snapshot.updatedAt);
    this.current = sanitize({ ...this.current, ...(snapshot.values as Partial<Settings>) });
    this.stamps = {
      ...this.stamps,
      ...Object.fromEntries(listed.map((k) => [k, isoTime(snapshot.stamps?.[k]) ?? copyAt ?? this.stamps[k]])),
    };
    this.save();
  }

  onLocalChange(listener: () => void): Unsubscribe {
    return this.localChanges.subscribe(listener);
  }

  private save(): void {
    const stored: Stored = { ...this.current, updatedAt: newest(this.stamps), stamps: this.stamps };
    this.store.set(KEY, JSON.stringify(stored));
    this.shown = withShownAccent(this.current, this.stamps);
    this.emitter.emit(this.shown);
  }

  private read(): Stored {
    try {
      const value: unknown = JSON.parse(this.store.get(KEY) ?? "{}");
      return value && typeof value === "object" ? (value as Stored) : {};
    } catch {
      return {};
    }
  }
}

/**
 * Known keys with valid values only, so a bad copy from storage or another device can't break
 * the UI: unknown ids, colors that aren't hex, lists that aren't lists or are too long. Custom
 * without a color to show falls back to the default.
 */
function sanitize(values: Partial<Record<keyof Settings, unknown>>): Settings {
  const customThemeColor = cleanColor(values.customThemeColor);
  const customAccentColor = cleanColor(values.customAccentColor);
  const theme = values.theme === "custom" ? (customThemeColor ? "custom" : null) : THEMES.find((t) => t.key === values.theme)?.key;
  const accent = values.accent === "custom" ? (customAccentColor ? "custom" : null) : ACCENTS.find((a) => a.key === values.accent)?.key;
  return {
    theme: theme ?? DEFAULTS.theme,
    customThemeColor,
    accent: accent ?? DEFAULTS.accent,
    customAccentColor,
    recentThemeColors: cleanColors(values.recentThemeColors),
    recentAccentColors: cleanColors(values.recentAccentColors),
    showLastSession: typeof values.showLastSession === "boolean" ? values.showLastSession : DEFAULTS.showLastSession,
  };
}

/** `settings` as shown: an accent nobody picked yet is the one its theme had before accents were a setting. */
function withShownAccent(settings: Settings, stamps: Stamps): Settings {
  if (Date.parse(stamps.accent) > 0) return settings;
  const accent: AccentName = settings.theme === "graphite" ? "blue" : "lime";
  return accent === settings.accent ? settings : { ...settings, accent };
}

/**
 * A color as stored: lowercase `#rrggbb`, or `#rrggbbaa` when it's see-through. Anything else
 * (another format, junk from a damaged copy) is null.
 */
export function cleanColor(value: unknown): string | null {
  if (typeof value !== "string" || !/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return null;
  const color = value.toLowerCase();
  return color.length === 9 && color.endsWith("ff") ? color.slice(0, 7) : color;
}

/** A list of recent colors: valid ones only, no repeats, at most `RECENT_COLORS`. */
function cleanColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value.slice(0, RECENT_COLORS * 4)) {
    const color = cleanColor(item);
    if (color && !out.includes(color)) out.push(color);
    if (out.length === RECENT_COLORS) break;
  }
  return out;
}

/** `list` with `color` in front: newest first, no repeats, at most `RECENT_COLORS`. */
export function withRecentColor(list: readonly string[], color: string): string[] {
  return cleanColors([color, ...list]);
}

/**
 * The stamp for a change made here: now, but never earlier than 1 ms after the stamp it
 * replaces. A copy adopted from a device whose clock runs ahead carries a stamp in this
 * device's future; a change made after adopting it must still outrank it.
 */
function nextStamp(previous: string, now: Date): string {
  const before = Date.parse(previous);
  const at = Math.max(now.getTime(), Number.isFinite(before) ? before + 1 : 0);
  return new Date(Math.min(at, LATEST_TIME)).toISOString();
}

/** The newest stamp, which is the whole copy's `updatedAt`. */
function newest(stamps: Stamps): string {
  return SETTING_KEYS.map((k) => stamps[k]).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a), EPOCH);
}

/** `value` as an ISO time, or undefined when it isn't a time (a damaged or hand-edited copy). */
function isoTime(value: unknown): string | undefined {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

/** localStorage, falling back to memory where it's blocked (private mode). */
export function browserKeyValueStore(): KeyValueStore {
  const memory = new Map<string, string>();
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
  };
}
