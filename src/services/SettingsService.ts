import { EPOCH } from "../domain/ids";
import { Emitter, type Unsubscribe } from "../lib/Emitter";
import { systemClock, type Clock, type KeyValueStore, type PreferencesSnapshot, type SyncedPreferences } from "./ports";

export type ThemeName = "oled" | "graphite";

export const THEMES: readonly { key: ThemeName; label: string; description: string }[] = [
  { key: "oled", label: "OLED", description: "True black, hairlines, lime accent" },
  { key: "graphite", label: "Graphite", description: "Charcoal cards, blue accent" },
];

export interface Settings {
  theme: ThemeName;
  /** Show "last 130 · 8/8/7" under each exercise while logging. */
  showLastSession: boolean;
}

const DEFAULTS: Settings = { theme: "oled", showLastSession: true };
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
 * with the account so the color style follows you between phone and computer (TASKS.md D20).
 * Each setting carries its own stamp, so devices merge them one by one.
 * Add new options to `Settings`, `DEFAULTS`, and `sanitize`.
 */
export class SettingsService implements SyncedPreferences {
  private current: Settings;
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
  }

  get(): Settings {
    return this.current;
  }

  /** Stamps only the settings in `changes`, so syncing them can't undo another device's newer change to a different one. */
  update(changes: Partial<Settings>): void {
    const now = this.clock.now();
    const changed = SETTING_KEYS.filter((k) => k in changes);
    this.current = sanitize({ ...this.current, ...changes });
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
    this.emitter.emit(this.current);
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

/** Known keys with valid values only, so a bad copy from storage or another device can't break the UI. */
function sanitize(values: Partial<Record<keyof Settings, unknown>>): Settings {
  return {
    theme: THEMES.some((t) => t.key === values.theme) ? (values.theme as ThemeName) : DEFAULTS.theme,
    showLastSession: typeof values.showLastSession === "boolean" ? values.showLastSession : DEFAULTS.showLastSession,
  };
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
