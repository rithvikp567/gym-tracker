import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppServices } from "../app/AppServices";
import type { Settings } from "../services/SettingsService";
import type { SyncStatus } from "../services/ports";

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices must be used inside <ServicesProvider>");
  return services;
}

/** Last loaded value per `cacheAs` + deps, so a screen you come back to draws at once. */
const liveCache = new Map<string, unknown>();
const LIVE_CACHE_LIMIT = 60;

function remember(key: string, value: unknown): void {
  liveCache.delete(key); // re-insert so the oldest entry is first in line to go
  liveCache.set(key, value);
  if (liveCache.size > LIVE_CACHE_LIMIT) liveCache.delete(liveCache.keys().next().value!);
}

/**
 * Loads async data and reloads it whenever stored data changes (a save here or a sync from
 * another device). Returns undefined while loading, and never shows data for old `deps`.
 *
 * With `cacheAs`, the last value for the same deps is shown right away while a fresh copy
 * loads, so switching tabs doesn't flash an empty screen first. Use a name unique to what
 * `load` returns.
 */
export function useLive<T>(load: () => Promise<T>, deps: readonly unknown[], cacheAs?: string): T | undefined {
  const { changes } = useServices();
  const key = JSON.stringify(deps);
  const cacheKey = cacheAs ? `${cacheAs}|${key}` : null;
  const [state, setState] = useState<{ key: string; value: T } | null>(() =>
    cacheKey && liveCache.has(cacheKey) ? { key, value: liveCache.get(cacheKey) as T } : null,
  );

  useEffect(() => {
    let alive = true;
    let version = 0;
    const run = () => {
      const mine = ++version;
      load().then(
        (value) => {
          if (!alive || mine !== version) return;
          if (cacheKey) remember(cacheKey, value);
          setState({ key, value });
        },
        (error: unknown) => console.error(error),
      );
    };
    run();
    const unsubscribe = changes.subscribe(run);
    return () => {
      alive = false;
      unsubscribe();
    };
    // `key` captures deps; `load` is recreated every render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cacheKey, changes]);

  if (state && state.key === key) return state.value;
  // New deps (another year, another day): show their cached copy, if any, until the load lands.
  return cacheKey && liveCache.has(cacheKey) ? (liveCache.get(cacheKey) as T) : undefined;
}

export function useSettings(): Settings {
  const { settings } = useServices();
  const [value, setValue] = useState(settings.get());
  useEffect(() => settings.subscribe(setValue), [settings]);
  return value;
}

export function useSyncStatus(): SyncStatus {
  const { sync } = useServices();
  const [value, setValue] = useState(sync.status());
  useEffect(() => sync.subscribe(setValue), [sync]);
  return value;
}
