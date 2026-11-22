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
const KEY = "gym-tracker.settings";

/**
 * Settings saved before they synced (no timestamp): older than any real change, so another
 * device's newer pick wins, but newer than untouched defaults, so a choice beats "never set".
 */
const PRE_SYNC_CHOICE = "1970-01-01T00:00:00.001Z";

interface Stored extends Partial<Settings> {
  updatedAt?: string;
}

/**
 * The user's preferences. Saved on this device right away and, when signed in, kept in step
 * with the account so the color style follows you between phone and computer (TASKS.md D20).
 * Add new options to `Settings`, `DEFAULTS`, and `sanitize`.
 */
export class SettingsService implements SyncedPreferences {
  private current: Settings;
  private updatedAt: string;
  private readonly emitter = new Emitter<Settings>();
  private readonly localChanges = new Emitter();

  constructor(
    private readonly store: KeyValueStore,
    private readonly clock: Clock = systemClock,
  ) {
    const saved = this.read();
    this.current = sanitize(saved);
    this.updatedAt = typeof saved.updatedAt === "string" ? saved.updatedAt : hasChoice(saved) ? PRE_SYNC_CHOICE : EPOCH;
  }

  get(): Settings {
    return this.current;
  }

  update(changes: Partial<Settings>): void {
    this.current = sanitize({ ...this.current, ...changes });
    this.updatedAt = this.clock.now().toISOString();
    this.save();
    this.localChanges.emit();
  }

  subscribe(listener: (s: Settings) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  snapshot(): PreferencesSnapshot {
    return { values: { ...this.current }, updatedAt: this.updatedAt };
  }

  applyRemote(snapshot: PreferencesSnapshot): void {
    this.current = sanitize({ ...this.current, ...(snapshot.values as Partial<Settings>) });
    this.updatedAt = snapshot.updatedAt;
    this.save();
  }

  onLocalChange(listener: () => void): Unsubscribe {
    return this.localChanges.subscribe(listener);
  }

  private save(): void {
    const stored: Stored = { ...this.current, updatedAt: this.updatedAt };
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

function hasChoice(saved: Stored): boolean {
  return saved.theme !== undefined || saved.showLastSession !== undefined;
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
