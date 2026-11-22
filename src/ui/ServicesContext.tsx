import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppServices } from "../app/AppServices";
import type { Settings } from "../services/SettingsService";
import type { ChangeFeed, SyncStatus } from "../services/ports";

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices must be used inside <ServicesProvider>");
  return services;
}

const LIVE_CACHE_LIMIT = 60;

/**
 * Last loaded value per `cacheAs` + deps, so a screen you come back to draws at once. One per
 * services instance, with a single `changes` subscription that counts data changes.
 *
 * Each entry keeps the generation its load *started* in. An entry from an older generation
 * may be out of date: screens still show it while a fresh copy loads, but never decide
 * "empty" or "missing" from it (a copy from before you set up your days would say "no days").
 */
class LiveCache {
  generation = 0;
  private readonly entries = new Map<string, { value: unknown; generation: number }>();
  /** Prefetches on their way: cache key → the generation they started in. */
  private readonly prefetching = new Map<string, number>();

  constructor(changes: ChangeFeed) {
    // Subscribed before any screen's own reload (the cache is created during the first render,
    // screens subscribe in effects), so a reload started by a change sees the new generation.
    changes.subscribe(() => {
      this.generation += 1;
    });
  }

  read(key: string): { value: unknown; fresh: boolean } | undefined {
    const entry = this.entries.get(key);
    return entry && { value: entry.value, fresh: entry.generation === this.generation };
  }

  /** Stores a value whose load started in `generation`, unless a later-loaded copy is already here. */
  write(key: string, value: unknown, generation: number): void {
    const old = this.entries.get(key);
    if (old && old.generation > generation) return;
    this.entries.delete(key); // re-insert so the oldest entry is first in line to go
    this.entries.set(key, { value, generation });
    if (this.entries.size > LIVE_CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
  }

  async prefetch(key: string, load: () => Promise<unknown>): Promise<void> {
    const generation = this.generation;
    if (this.read(key)?.fresh || this.prefetching.get(key) === generation) return;
    this.prefetching.set(key, generation);
    try {
      this.write(key, await load(), generation);
    } catch (error: unknown) {
      console.error(error);
    } finally {
      if (this.prefetching.get(key) === generation) this.prefetching.delete(key);
    }
  }
}

const liveCaches = new WeakMap<ChangeFeed, LiveCache>();

function liveCacheFor(changes: ChangeFeed): LiveCache {
  let cache = liveCaches.get(changes);
  if (!cache) {
    cache = new LiveCache(changes);
    liveCaches.set(changes, cache);
  }
  return cache;
}

/** The cache key for `cacheAs` + deps; `useLive` and `prefetchLive` must agree on it. */
function liveKey(cacheAs: string, deps: readonly unknown[]): string {
  return `${cacheAs}|${JSON.stringify(deps)}`;
}

export interface Live<T> {
  /** The value for the current deps: this screen's own load, or a cached copy while it loads. */
  value: T | undefined;
  /**
   * True when `value` was up to date when it was shown: this screen loaded it, or it's a cached
   * copy loaded after the last data change. Show "empty" or "missing" states only on fresh data.
   * (A change while it's on screen reloads it as always, without marking it stale meanwhile, so
   * an empty state that's showing doesn't blink.)
   */
  fresh: boolean;
  /** What this screen last loaded for other deps (e.g. the week before), to keep showing while `value` loads. */
  previous: T | undefined;
}

/**
 * Loads async data and reloads it whenever stored data changes (a save here or a sync from
 * another device). `value` is undefined while loading, and never holds data for old `deps`.
 *
 * With `cacheAs`, the last value for the same deps is shown right away while a fresh copy
 * loads, so switching tabs doesn't flash an empty screen first. Use a name unique to what
 * `load` returns.
 */
export function useLiveState<T>(load: () => Promise<T>, deps: readonly unknown[], cacheAs?: string): Live<T> {
  const { changes } = useServices();
  const cache = liveCacheFor(changes);
  const key = JSON.stringify(deps);
  const cacheKey = cacheAs ? liveKey(cacheAs, deps) : null;
  const [state, setState] = useState<{ key: string; value: T; fresh: boolean } | null>(() => {
    const hit = cacheKey ? cache.read(cacheKey) : undefined;
    return hit ? { key, value: hit.value as T, fresh: hit.fresh } : null;
  });

  useEffect(() => {
    let alive = true;
    let version = 0;
    const run = () => {
      const mine = ++version;
      const generation = cache.generation;
      load().then(
        (value) => {
          // A change since this load started has started another one: only the newest lands.
          if (!alive || mine !== version) return;
          if (cacheKey) cache.write(cacheKey, value, generation);
          setState({ key, value, fresh: true });
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
  }, [key, cacheKey, changes, cache]);

  if (state && state.key === key) return { value: state.value, fresh: state.fresh, previous: undefined };
  // New deps (another year, another day): show their cached copy, if any, until the load lands.
  const hit = cacheKey ? cache.read(cacheKey) : undefined;
  return { value: hit?.value as T | undefined, fresh: hit?.fresh ?? false, previous: state?.value };
}

/** `useLiveState` for screens that only need the value. */
export function useLive<T>(load: () => Promise<T>, deps: readonly unknown[], cacheAs?: string): T | undefined {
  return useLiveState(load, deps, cacheAs).value;
}

/**
 * Loads a value into the cache ahead of time, under the same key `useLive(load, deps, cacheAs)`
 * reads, so opening it later draws at once (e.g. the weeks next to the one on Home). Skips
 * values that are already fresh or on their way.
 */
export function prefetchLive<T>(
  { changes }: Pick<AppServices, "changes">,
  cacheAs: string,
  deps: readonly unknown[],
  load: () => Promise<T>,
): Promise<void> {
  return liveCacheFor(changes).prefetch(liveKey(cacheAs, deps), load);
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
