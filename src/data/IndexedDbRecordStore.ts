import { openDB, type IDBPDatabase } from "idb";
import type { Syncable } from "../domain/ids";
import { TABLES, outboxKey, type OutboxEntry, type Origin, type RecordStore, type TableName } from "./RecordStore";

const DB_NAME = "gym-tracker";
const DB_VERSION = 1;
const OUTBOX = "outbox";
const META = "meta";

/**
 * The on-device database. Every write lands here first, so logging works with no signal;
 * local writes and their outbox entries are committed in one transaction.
 */
export class IndexedDbRecordStore implements RecordStore {
  private constructor(private readonly db: IDBPDatabase) {}

  static async open(): Promise<IndexedDbRecordStore> {
    const db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const table of TABLES) db.createObjectStore(table, { keyPath: "id" });
        db.createObjectStore(OUTBOX, { keyPath: "key" });
        db.createObjectStore(META);
      },
    });
    // Ask the browser not to evict our data under storage pressure.
    void navigator.storage?.persist?.();
    return new IndexedDbRecordStore(db);
  }

  async getAll<T extends Syncable>(table: TableName): Promise<T[]> {
    return (await this.db.getAll(table)) as T[];
  }

  async get<T extends Syncable>(table: TableName, id: string): Promise<T | undefined> {
    return (await this.db.get(table, id)) as T | undefined;
  }

  async putMany<T extends Syncable>(table: TableName, records: T[], origin: Origin): Promise<void> {
    const tx = this.db.transaction([table, OUTBOX], "readwrite");
    const data = tx.objectStore(table);
    const outbox = tx.objectStore(OUTBOX);
    for (const record of records) {
      void data.put(record);
      if (origin === "local") {
        const entry: OutboxEntry = { key: outboxKey(table, record.id), table, id: record.id, updatedAt: record.updatedAt };
        void outbox.put(entry);
      }
    }
    await tx.done;
  }

  async outbox(): Promise<OutboxEntry[]> {
    return (await this.db.getAll(OUTBOX)) as OutboxEntry[];
  }

  async clearOutbox(entries: OutboxEntry[]): Promise<void> {
    const tx = this.db.transaction(OUTBOX, "readwrite");
    for (const e of entries) {
      const current = (await tx.store.get(e.key)) as OutboxEntry | undefined;
      if (current?.updatedAt === e.updatedAt) await tx.store.delete(e.key);
    }
    await tx.done;
  }

  async getMeta(key: string): Promise<string | undefined> {
    return (await this.db.get(META, key)) as string | undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.put(META, value, key);
  }
}
