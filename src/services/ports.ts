/**
 * Interfaces the services depend on. Implementations live in src/data (IndexedDB, memory,
 * Supabase); services never import them directly, so storage can change without touching
 * business logic.
 */
import type { LocalDate } from "../domain/LocalDate";
import type { Session, SessionData } from "../domain/Session";
import type { Split, SplitData } from "../domain/Split";
import type { Profile } from "../domain/social/Profile";
import type { FriendRequestOutcome, SocialOverview } from "../domain/social/SocialOverview";
import type { Username } from "../domain/social/Username";
import type { WeekTally } from "../domain/social/WeekTally";
import type { WorkoutDay, WorkoutDayData } from "../domain/WorkoutDay";
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
  /**
   * Saves corrections to stored sessions (SetupService.reconcile) dated 1 ms after the copy each
   * was made from, not now: an edit made on any device after that copy still wins in sync. Each
   * is saved only if the stored copy is still the one it was made from (`updatedAt` unchanged),
   * so a save or sync that landed meanwhile is never overwritten. Returns how many were saved.
   * Two devices that correct the same copy differently (each before hearing the other's merge or
   * delete) save the same stamp; sync settles such a tie the same way everywhere (recordSync.settle).
   */
  saveRepairs(sessions: Session[]): Promise<number>;
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

/** A friend's own records, as the server hands them over: notes are already removed. */
export interface FriendRecords {
  days: WorkoutDayData[];
  split: SplitData | null;
  /** Sessions on or after the date asked for. */
  sessions: SessionData[];
}

/** Why a social call failed, so the screen can say what to do about it. */
export type SocialProblem =
  /** No backend for this site (or the demo has none). */
  | "unavailable"
  | "signed-out"
  /** The backend hasn't been given the social tables yet (supabase/migrations/0002_social.sql). */
  | "not-set-up"
  | "offline"
  | "username-taken"
  | "not-friends"
  | "failed";

export class SocialError extends Error {
  constructor(readonly problem: SocialProblem, message?: string) {
    super(message ?? problem);
    this.name = "SocialError";
  }
}

/**
 * Friends and rooms on the server, for the signed-in account (TASKS.md D53). Implementations:
 * `SupabaseSocial` (the app), `MemorySocial` (tests and the ?demo preview), `NoSocial` (no
 * backend). Failures are `SocialError`s.
 */
export interface SocialGateway {
  /** False when there's no backend at all: the Social page says so instead of trying. */
  readonly available: boolean;
  /** Whether a username is free (works signed out, for the sign-up form). */
  isUsernameFree(username: Username): Promise<boolean>;
  /** Picks (or changes) the signed-in account's username and display name. */
  claimProfile(username: Username, displayName: string): Promise<Profile>;
  /** Requests, friends, room invites and rooms, with scores for `thisWeek` and `lastWeek` (Mondays). */
  overview(thisWeek: LocalDate, lastWeek: LocalDate): Promise<SocialOverview>;
  requestFriend(username: Username): Promise<FriendRequestOutcome>;
  /** Accepts or declines a request from `fromId`. */
  answerFriend(fromId: string, accept: boolean): Promise<void>;
  /** Removes a friend, or takes back a request either way. */
  unfriend(otherId: string): Promise<void>;
  /** A friend's workout days, split and sessions since `since`, notes removed. */
  friendRecords(friendId: string, since: LocalDate): Promise<FriendRecords>;
  /** Creates a room you're in, inviting friends; returns its id. */
  createRoom(name: string, inviteIds: readonly string[]): Promise<string>;
  /** Invites more friends to a room you're in. */
  invite(roomId: string, inviteIds: readonly string[]): Promise<void>;
  answerInvite(roomId: string, accept: boolean): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  /** Publishes your own weekly scores (this week and last) and streak, for friends and rooms. */
  publishTallies(tallies: readonly WeekTally[], streak: number): Promise<void>;
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
  /** Emails a 6-digit code for setting a new password (needs the backend's mail set up, docs/SOCIAL_SETUP.md). */
  requestPasswordReset(email: string): Promise<void>;
  /** Checks the emailed code, sets the new password, and signs in. */
  resetPassword(email: string, code: string, newPassword: string): Promise<void>;
  /** The signed-in account's id, or null. */
  userId(): string | null;
  signOut(): Promise<void>;
  /** A sync the person asked for (the Sync button): also re-reads the account's preferences. */
  syncNow(): Promise<void>;
  /** Called after local writes; implementations debounce. */
  requestSync(): void;
}
