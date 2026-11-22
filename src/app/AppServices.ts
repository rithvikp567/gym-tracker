import { IndexedDbRecordStore } from "../data/IndexedDbRecordStore";
import { MemoryRecordStore } from "../data/MemoryRecordStore";
import { NoSync } from "../data/NoSync";
import { StoreRepositories } from "../data/StoreRepositories";
import { BackupService } from "../services/BackupService";
import { CalendarService } from "../services/CalendarService";
import { ImportService } from "../services/ImportService";
import { systemClock, type ChangeFeed, type SyncController } from "../services/ports";
import { ProgressService } from "../services/ProgressService";
import { SessionService } from "../services/SessionService";
import { SetupService } from "../services/SetupService";
import { browserKeyValueStore, SettingsService } from "../services/SettingsService";
import { seedDemoData } from "./demoData";

/** Everything the UI can use. Screens get this from context and never build services themselves. */
export interface AppServices {
  mode: "device" | "demo";
  changes: ChangeFeed;
  setup: SetupService;
  sessions: SessionService;
  calendar: CalendarService;
  progress: ProgressService;
  imports: ImportService;
  backup: BackupService;
  settings: SettingsService;
  sync: SyncController;
}

/**
 * Composition root: the one place that picks implementations.
 *   ?demo        → sample data in memory (nothing saved, no sync)
 *   otherwise    → IndexedDB on this device, plus Supabase sync when configured
 */
export async function createAppServices(): Promise<AppServices> {
  const demo = new URLSearchParams(location.search).has("demo");
  const store = demo ? new MemoryRecordStore() : await IndexedDbRecordStore.open();

  let sync: SyncController = new NoSync();
  const repos = new StoreRepositories(store, systemClock, () => sync.requestSync());

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  if (demo) {
    await seedDemoData(repos, systemClock);
  } else if (url && key) {
    const { SupabaseSync } = await import("../data/SupabaseSync");
    sync = new SupabaseSync(url, key, store, () => repos.notifyExternalChange());
  }

  return {
    mode: demo ? "demo" : "device",
    changes: repos.changes,
    setup: new SetupService(repos),
    sessions: new SessionService(repos),
    calendar: new CalendarService(repos, systemClock),
    progress: new ProgressService(repos, systemClock),
    imports: new ImportService(repos),
    backup: new BackupService(repos),
    settings: new SettingsService(browserKeyValueStore()),
    sync,
  };
}
