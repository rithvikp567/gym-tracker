import type { Syncable } from "../domain/ids";

/** Table names, shared by the local store and the Supabase schema. */
export type TableName = "workout_days" | "sessions" | "splits";
export const TABLES: readonly TableName[] = ["workout_days", "sessions", "splits"];

/** local = a change made on this device (queued for upload); remote = applied from sync. */
export type Origin = "local" | "remote";

/** A local change waiting to be pushed. */
export interface OutboxEntry {
  key: string;
  table: TableName;
  id: string;
  updatedAt: string;
}

/**
 * Low-level record storage. Repositories are written once against this interface and work
 * with any implementation (IndexedDB in the app, memory in tests and demo mode).
 */
export interface RecordStore {
  getAll<T extends Syncable>(table: TableName): Promise<T[]>;
  get<T extends Syncable>(table: TableName, id: string): Promise<T | undefined>;
  putMany<T extends Syncable>(table: TableName, records: T[], origin: Origin): Promise<void>;
  /**
   * Saves each record as a local change only if the stored copy still has the `updatedAt` it was
   * made from (`basedOn`), checked and written in one transaction: a copy saved or synced in
   * meanwhile is left alone. Returns the ids saved.
   */
  putIfUnchanged<T extends Syncable>(table: TableName, records: { record: T; basedOn: string }[]): Promise<string[]>;
  outbox(): Promise<OutboxEntry[]>;
  /** Removes entries that haven't changed since they were read (a newer edit stays queued). */
  clearOutbox(entries: OutboxEntry[]): Promise<void>;
  /** Removes every record and queued upload (another account's data), keeping meta. */
  clear(): Promise<void>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
}

export function outboxKey(table: TableName, id: string): string {
  return `${table}:${id}`;
}
