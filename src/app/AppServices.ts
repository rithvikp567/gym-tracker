import { IndexedDbRecordStore } from "../data/IndexedDbRecordStore";
import { MemoryRecordStore } from "../data/MemoryRecordStore";
import { NoSocial } from "../data/NoSocial";
import { NoSync } from "../data/NoSync";
import { StoreRepositories } from "../data/StoreRepositories";
import { BackupService } from "../services/BackupService";
import { CalendarService } from "../services/CalendarService";
import { ImportService } from "../services/ImportService";
import { systemClock, type ChangeFeed, type SocialGateway, type SyncController } from "../services/ports";
import { ProgressService } from "../services/ProgressService";
import { SessionService } from "../services/SessionService";
import { SetupService } from "../services/SetupService";
import { browserKeyValueStore, SettingsService } from "../services/SettingsService";
import { SocialService } from "../services/SocialService";
import { TimerService } from "../services/TimerService";
import { seedDemoData, seedDemoSocial } from "./demoData";

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
  social: SocialService;
  timer: TimerService;
}

/**
 * Composition root: the one place that picks implementations.
 *   ?demo        → sample data and sample friends in memory (nothing saved, no sync)
 *   otherwise    → IndexedDB on this device, plus Supabase sync and social when configured
 */
export async function createAppServices(): Promise<AppServices> {
  const demo = new URLSearchParams(location.search).has("demo");
  const store = demo ? new MemoryRecordStore() : await IndexedDbRecordStore.open();

  let sync: SyncController = new NoSync();
  let gateway: SocialGateway = new NoSocial();
  const repos = new StoreRepositories(store, systemClock, () => sync.requestSync());
  const setup = new SetupService(repos);
  // Logs that synced in for an exercise merged or deleted on another device get filed into the
  // exercise it became, or dropped with it. A background repair: a failure only waits for the next run.
  const fileLateLogs = () => void setup.reconcile().catch((e: unknown) => console.warn("Couldn't file late logs", e));

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  if (demo) {
    await seedDemoData(repos, systemClock);
    gateway = seedDemoSocial(systemClock);
  } else if (url && key) {
    const [{ connectSupabase }, { SupabaseSync }, { SupabaseSocial }] = await Promise.all([
      import("../data/supabaseClient"),
      import("../data/SupabaseSync"),
      import("../data/SupabaseSocial"),
    ]);
    const client = connectSupabase(url, key);
    const supabaseSync = new SupabaseSync(client, store, () => {
      repos.notifyExternalChange();
      fileLateLogs();
    });
    sync = supabaseSync;
    gateway = new SupabaseSocial(client, () => supabaseSync.userId());
  }
  fileLateLogs(); // once at startup too, for anything an earlier visit synced but didn't file

  const deviceStore = browserKeyValueStore();
  const settings = new SettingsService(deviceStore, systemClock);
  sync.attachPreferences(settings);

  const social = new SocialService(gateway, repos, systemClock);
  // Friends and rooms see your weekly score a few seconds after you log, and right after you sign in.
  social.publishOnChanges(repos.changes, accountChanges(sync), () => demo || sync.userId() !== null);

  return {
    mode: demo ? "demo" : "device",
    changes: repos.changes,
    setup,
    sessions: new SessionService(repos),
    calendar: new CalendarService(repos, systemClock),
    progress: new ProgressService(repos, systemClock),
    imports: new ImportService(repos),
    backup: new BackupService(repos),
    settings,
    sync,
    social,
    timer: new TimerService(deviceStore, settings, systemClock),
  };
}

/** Fires when the signed-in account changes (not on every sync status update). */
function accountChanges(sync: SyncController): ChangeFeed {
  return {
    subscribe(listener) {
      let account = sync.userId();
      return sync.subscribe(() => {
        if (sync.userId() === account) return;
        account = sync.userId();
        listener();
      });
    },
  };
}
