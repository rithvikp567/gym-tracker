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

/**
 * Loads async data and reloads it whenever stored data changes (a save here or a sync from
 * another device). Returns undefined while loading, and never shows data for old `deps`.
 */
export function useLive<T>(load: () => Promise<T>, deps: readonly unknown[]): T | undefined {
  const { changes } = useServices();
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string; value: T } | null>(null);

  useEffect(() => {
    let alive = true;
    let version = 0;
    const run = () => {
      const mine = ++version;
      load().then(
        (value) => {
          if (alive && mine === version) setState({ key, value });
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
  }, [key, changes]);

  return state && state.key === key ? state.value : undefined;
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
