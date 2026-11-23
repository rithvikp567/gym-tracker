import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeFeed } from "../../services/ports";

export interface Remote<T> {
  /** The latest value, or the last one loaded for the same key while a fresh copy loads. */
  value: T | undefined;
  /** The last load's failure, until a load succeeds. */
  error: Error | null;
  /** A load is under way. */
  loading: boolean;
  reload: () => void;
}

/** Last value per key, so coming back to a page draws at once (server data, not stored on the device). */
const cache = new Map<string, unknown>();

/** Clears the remembered values (signing out, tests). */
export function forgetRemote(): void {
  cache.clear();
}

/**
 * Loads data from the server (friends, rooms), unlike `useLiveState`, which reads this device's
 * store: reloads when `feed` fires (an action changed it), when the app comes back to the front,
 * and on `reload()`; a failure is kept in `error` instead of leaving the page loading forever.
 * `key` names what's loaded; the value for one key is never shown for another.
 */
export function useRemote<T>(key: string, load: () => Promise<T>, feed: ChangeFeed): Remote<T> {
  const [state, setState] = useState<{ key: string; value: T | undefined; error: Error | null; loading: boolean }>(() => ({
    key,
    value: cache.get(key) as T | undefined,
    error: null,
    loading: true,
  }));
  const loadRef = useRef(load);
  loadRef.current = load;
  const version = useRef(0);

  const run = useCallback(() => {
    const mine = ++version.current;
    setState((s) => (s.key === key ? { ...s, loading: true } : { key, value: cache.get(key) as T | undefined, error: null, loading: true }));
    loadRef.current().then(
      (value) => {
        if (mine !== version.current) return;
        cache.set(key, value);
        setState({ key, value, error: null, loading: false });
      },
      (error: unknown) => {
        if (mine !== version.current) return;
        setState((s) => ({ ...s, key, error: error instanceof Error ? error : new Error(String(error)), loading: false }));
      },
    );
  }, [key]);

  useEffect(() => {
    run();
    const stop = feed.subscribe(run);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      version.current++;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run, feed]);

  if (state.key !== key) return { value: cache.get(key) as T | undefined, error: null, loading: true, reload: run };
  return { value: state.value, error: state.error, loading: state.loading, reload: run };
}
