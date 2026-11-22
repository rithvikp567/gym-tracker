import { useCallback, useReducer } from "react";

/**
 * Remembers a screen's view choices (picked day, time range, hidden chart lines, calendar
 * year…) so they're still there after visiting another tab. Screens unmount when you switch
 * tabs, so component state alone would reset.
 *
 * - `"session"` keeps the value until the app is closed (e.g. the calendar year).
 * - `"device"` also saves it in this browser's storage, so it survives restarts (chart filters).
 *
 * Per-device convenience only: never synced, and safe to lose (falls back to `fallback`).
 */
export type ViewStateScope = "session" | "device";

const memory = new Map<string, unknown>();
const STORAGE_PREFIX = "gym-tracker.view.";

export function useViewState<T>(key: string, fallback: () => T, scope: ViewStateScope = "session"): [T, (next: T) => void] {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  let value = read(key, scope) as T | undefined;
  if (value === undefined) {
    // Keep the default in memory too, so every render sees the same object (stable for effects/memo).
    value = fallback();
    memory.set(key, value);
  }
  const set = useCallback(
    (next: T) => {
      write(key, next, scope);
      rerender();
    },
    [key, scope],
  );
  return [value, set];
}

function read(key: string, scope: ViewStateScope): unknown {
  if (memory.has(key)) return memory.get(key);
  if (scope !== "device") return undefined;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown, scope: ViewStateScope): void {
  memory.set(key, value);
  if (scope !== "device") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: the in-memory copy still works for this visit.
  }
}
