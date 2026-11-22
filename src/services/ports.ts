/**
 * Interfaces the services depend on. Implementations live in src/data (IndexedDB, memory,
 * Supabase); services never import them directly, so storage can change without touching
 * business logic.
 */
import type { LocalDate } from "../domain/LocalDate";
import type { Session } from "../domain/Session";
import type { Split } from "../domain/Split";
import type { WorkoutDay } from "../domain/WorkoutDay";
import type { Unsubscribe } from "../lib/Emitter";

export interface WorkoutDayRepository {
  /** Non-deleted days, sorted by order. */
  all(): Promise<WorkoutDay[]>;
  get(id: string): Promise<WorkoutDay | undefined>;
  save(day: WorkoutDay): Promise<WorkoutDay>;
  saveMany(days: WorkoutDay[]): Promise<void>;
}

export interface SessionRepository {
  get(id: string): Promise<Session | undefined>;
  /** Non-deleted sessions, oldest first. */
  all(): Promise<Session[]>;
  forWorkoutDay(workoutDayId: string): Promise<Session[]>;
  onDate(date: LocalDate): Promise<Session[]>;
  save(session: Session): Promise<Session>;
  saveMany(sessions: Session[]): Promise<void>;
}

export interface SplitRepository {
  get(): Promise<Split>;
  save(split: Split): Promise<Split>;
}

/** Fires whenever stored data changes (locally or from sync). */
export interface ChangeFeed {
  subscribe(listener: () => void): Unsubscribe;
}

export interface Repositories {
  days: WorkoutDayRepository;
  sessions: SessionRepository;
  split: SplitRepository;
  changes: ChangeFeed;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Small string key/value storage for device preferences (localStorage in the browser). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export type SyncState = "off" | "signed-out" | "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  email: string | null;
  lastSyncedAt: Date | null;
  message: string | null;
}

/**
 * Preferences that follow the account to the user's other devices (color style…), as one
 * snapshot. Each setting keeps the time it last changed, and the newest change to each
 * setting wins, so changing one setting never undoes another device's newer change to another.
 */
export interface PreferencesSnapshot {
  values: Record<string, unknown>;
  /** ISO time of the newest change to any setting; EPOCH = never changed (still the defaults). */
  updatedAt: string;
  /**
   * ISO time each setting last changed, on any device. Copies saved before settings were
   * stamped one by one have none: a setting without a stamp counts as changed at `updatedAt`.
   */
  stamps?: Record<string, string>;
}

/** Implemented by SettingsService; read and updated by sync. */
export interface SyncedPreferences {
  snapshot(): PreferencesSnapshot;
  /**
   * Applies another device's copy (the settings it lists, with their stamps) without queueing
   * it for upload again. Settings it doesn't list keep their value here.
   */
  applyRemote(snapshot: PreferencesSnapshot): void;
  /** Fires after a change made on this device. */
  onLocalChange(listener: () => void): Unsubscribe;
}

/** Account + sync, as the UI sees it. `NoSync` is used when no backend is configured. */
export interface SyncController {
  readonly configured: boolean;
  /** Hands sync the preferences to keep in step with the account (call once at startup). */
  attachPreferences(preferences: SyncedPreferences): void;
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<void>;
  /** Creates the account and signs in (Supabase's "Confirm email" must be off; no email is sent). */
  createAccount(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** A sync the person asked for (the Sync button): also re-reads the account's preferences. */
  syncNow(): Promise<void>;
  /** Called after local writes; implementations debounce. */
  requestSync(): void;
}
