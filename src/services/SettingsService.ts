import { Emitter, type Unsubscribe } from "../lib/Emitter";
import type { KeyValueStore } from "./ports";

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

/** Per-device preferences. Add new options to `Settings` + `DEFAULTS`. */
export class SettingsService {
  private current: Settings;
  private readonly emitter = new Emitter<Settings>();

  constructor(private readonly store: KeyValueStore) {
    this.current = { ...DEFAULTS, ...this.read() };
  }

  get(): Settings {
    return this.current;
  }

  update(changes: Partial<Settings>): void {
    this.current = { ...this.current, ...changes };
    this.store.set(KEY, JSON.stringify(this.current));
    this.emitter.emit(this.current);
  }

  subscribe(listener: (s: Settings) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  private read(): Partial<Settings> {
    try {
      return JSON.parse(this.store.get(KEY) ?? "{}") as Partial<Settings>;
    } catch {
      return {};
    }
  }
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
