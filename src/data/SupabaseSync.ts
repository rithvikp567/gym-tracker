import { createClient, type Session as AuthSession, type SupabaseClient } from "@supabase/supabase-js";
import { EPOCH, type Syncable } from "../domain/ids";
import { Emitter, type Unsubscribe } from "../lib/Emitter";
import type { SyncController, SyncedPreferences, SyncStatus } from "../services/ports";
import { readPreferences, reconcilePreferences } from "./preferenceSync";
import { TABLES, type RecordStore, type TableName } from "./RecordStore";

interface RemoteRow {
  id: string;
  data: Syncable;
  updated_at: string;
  deleted: boolean;
  server_updated_at: string;
}

const PAGE = 500;
const PUSH_CHUNK = 200;
/** Re-read a few seconds before the last cursor in case rows committed out of order. */
const OVERLAP_MS = 5_000;
/** Preferences live in the account's user metadata under this key, so they need no table. */
const PREFS_KEY = "gym_tracker_prefs";
/** Edits sync every few seconds; in between, the account's preferences are re-read at most this often. */
const PREFS_REFRESH_MS = 60_000;

/**
 * Supabase account (email + password) + two-way sync of the local store.
 *
 *  push: upload every record in the outbox (upsert; the server keeps whichever copy has the
 *        newer `updated_at`, see supabase/migrations).
 *  pull: download rows changed since the last pull (by server time) and apply the ones newer
 *        than what's on this device.
 *  prefs: keep the preferences (color style…) in step with the account's user metadata,
 *        newest change wins (TASKS.md D20).
 */
export class SupabaseSync implements SyncController {
  readonly configured = true;
  private readonly client: SupabaseClient;
  private readonly emitter = new Emitter<SyncStatus>();
  private current: SyncStatus = { state: "signed-out", email: null, lastSyncedAt: null, message: null };
  private userId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private prefs: SyncedPreferences | null = null;
  /** Bumped on every local preference change; compared with the last version synced. */
  private prefsVersion = 0;
  private prefsSyncedVersion = 0;
  /** Re-read the account's preferences on the next sync (app opened, back in front, signed in). */
  private prefsCheckDue = true;
  private prefsCheckedAt = 0;

  constructor(
    url: string,
    key: string,
    private readonly store: RecordStore,
    private readonly onRemoteChange: () => void,
  ) {
    this.client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    // Don't call Supabase inside this callback (it can deadlock); defer instead.
    this.client.auth.onAuthStateChange((_event, session) => setTimeout(() => this.onAuth(session), 0));
    window.addEventListener("online", () => {
      this.prefsCheckDue = true;
      this.requestSync(0);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      this.prefsCheckDue = true;
      this.requestSync(0);
    });
  }

  status(): SyncStatus {
    return this.current;
  }

  subscribe(listener: (status: SyncStatus) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  attachPreferences(preferences: SyncedPreferences): void {
    this.prefs = preferences;
    preferences.onLocalChange(() => {
      this.prefsVersion++;
      this.requestSync(0);
    });
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendlyAuthError(error.message));
  }

  async createAccount(email: string, password: string): Promise<void> {
    const { data, error } = await this.client.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(friendlyAuthError(error.message));
    // With "Confirm email" on, Supabase holds the account until a link is clicked, which the
    // installed iPhone app can't receive. Say what to change instead of silently waiting.
    if (!data.session) {
      throw new Error('Account created but not signed in: turn off "Confirm email" in Supabase (Authentication → Sign In / Providers), then sign in.');
    }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  requestSync(delayMs = 1500): void {
    if (!this.userId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), delayMs);
  }

  async syncNow(): Promise<void> {
    if (!this.userId) return;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.requestSync(0);
      }
    });
    return this.running;
  }

  private async run(): Promise<void> {
    if (!navigator.onLine) {
      this.set({ state: "offline", message: "Offline. Changes are saved on this device and will sync later." });
      return;
    }
    this.set({ state: "syncing", message: null });
    try {
      await this.push();
      await this.pull();
      // Preferences are a nicety: a failure here never marks the whole sync as failed.
      await this.syncPreferences().catch((e: unknown) => console.warn("Preferences didn't sync", e));
      this.set({ state: "idle", lastSyncedAt: new Date(), message: null });
    } catch (e) {
      const offline = !navigator.onLine || e instanceof TypeError;
      this.set({
        state: offline ? "offline" : "error",
        message: offline ? "Offline. Changes will sync later." : `Sync failed: ${(e as Error).message}`,
      });
    }
  }

  private async push(): Promise<void> {
    const entries = await this.store.outbox();
    for (const table of TABLES) {
      const mine = entries.filter((e) => e.table === table);
      for (let i = 0; i < mine.length; i += PUSH_CHUNK) {
        const chunk = mine.slice(i, i + PUSH_CHUNK);
        const records = (await Promise.all(chunk.map((e) => this.store.get(table, e.id)))).filter(
          (r): r is Syncable => r !== undefined,
        );
        const rows = records.map((r) => ({
          id: r.id,
          user_id: this.userId,
          data: r,
          updated_at: r.updatedAt,
          deleted: r.deleted,
        }));
        if (rows.length) {
          const { error } = await this.client.from(table).upsert(rows, { onConflict: "user_id,id" });
          if (error) throw new Error(error.message);
        }
        await this.store.clearOutbox(chunk);
      }
    }
  }

  private async pull(): Promise<void> {
    let changed = false;
    for (const table of TABLES) {
      const cursorKey = `pull:${this.userId}:${table}`;
      const cursor = (await this.store.getMeta(cursorKey)) ?? EPOCH;
      const since = new Date(Math.max(0, Date.parse(cursor) - OVERLAP_MS)).toISOString();
      let latest = cursor;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await this.client
          .from(table)
          .select("id,data,updated_at,deleted,server_updated_at")
          .gt("server_updated_at", since)
          .order("server_updated_at")
          .order("id")
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as RemoteRow[];
        if (await this.apply(table, rows)) changed = true;
        const last = rows.at(-1)?.server_updated_at;
        if (last && Date.parse(last) > Date.parse(latest)) latest = new Date(last).toISOString();
        if (rows.length < PAGE) break;
      }
      await this.store.setMeta(cursorKey, latest);
    }
    if (changed) this.onRemoteChange();
  }

  /** Compares this device's preferences with the account's copy and keeps the newer one. */
  private async syncPreferences(): Promise<void> {
    const prefs = this.prefs;
    if (!prefs) return;
    const version = this.prefsVersion;
    const changedHere = version !== this.prefsSyncedVersion;
    if (!changedHere && !this.prefsCheckDue && Date.now() - this.prefsCheckedAt < PREFS_REFRESH_MS) return;

    const { data, error } = await this.client.auth.getUser();
    if (error) throw error;
    const remote = readPreferences(data.user?.user_metadata?.[PREFS_KEY]);
    const local = prefs.snapshot();
    const action = reconcilePreferences(local, remote);
    if (action === "adopt" && remote) {
      prefs.applyRemote(remote);
    } else if (action === "push") {
      const { error: updateError } = await this.client.auth.updateUser({ data: { [PREFS_KEY]: local } });
      if (updateError) throw updateError;
    }
    this.prefsSyncedVersion = version;
    this.prefsCheckDue = false;
    this.prefsCheckedAt = Date.now();
  }

  /** Keeps whichever copy was edited last. Returns true if anything local changed. */
  private async apply(table: TableName, rows: RemoteRow[]): Promise<boolean> {
    const newer: Syncable[] = [];
    for (const row of rows) {
      const remote: Syncable = { ...row.data, id: row.id, updatedAt: new Date(row.updated_at).toISOString(), deleted: row.deleted };
      const local = await this.store.get(table, row.id);
      if (!local || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt)) newer.push(remote);
    }
    if (newer.length) await this.store.putMany(table, newer, "remote");
    return newer.length > 0;
  }

  private onAuth(session: AuthSession | null): void {
    const user = session?.user ?? null;
    const isNewUser = (user?.id ?? null) !== this.userId;
    this.userId = user?.id ?? null;
    if (user && isNewUser) this.prefsCheckDue = true;
    this.set({ state: user ? "idle" : "signed-out", email: user?.email ?? null, message: null });
    if (user && isNewUser) this.requestSync(0);
  }

  private set(changes: Partial<SyncStatus>): void {
    this.current = { ...this.current, ...changes };
    this.emitter.emit(this.current);
  }
}

/** Supabase's auth messages, reworded for the few cases a person will actually hit. */
function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/email not confirmed/i.test(message)) return 'This email isn\'t confirmed. Turn off "Confirm email" in Supabase, or confirm it under Authentication → Users.';
  if (/signups? not allowed|sign ?ups? (are )?disabled/i.test(message)) return "New accounts are turned off for this site.";
  if (/already registered/i.test(message)) return "There's already an account with this email. Sign in instead.";
  return message;
}
