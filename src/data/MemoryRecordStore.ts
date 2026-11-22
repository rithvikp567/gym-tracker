import type { Syncable } from "../domain/ids";
import { outboxKey, type OutboxEntry, type Origin, type RecordStore, type TableName } from "./RecordStore";

/** In-memory store for tests and the ?demo preview. Nothing persists. */
export class MemoryRecordStore implements RecordStore {
  private readonly tables = new Map<TableName, Map<string, Syncable>>();
  private readonly queue = new Map<string, OutboxEntry>();
  private readonly meta = new Map<string, string>();

  async getAll<T extends Syncable>(table: TableName): Promise<T[]> {
    return [...this.table(table).values()].map((r) => structuredClone(r) as T);
  }

  async get<T extends Syncable>(table: TableName, id: string): Promise<T | undefined> {
    const r = this.table(table).get(id);
    return r ? (structuredClone(r) as T) : undefined;
  }

  async putMany<T extends Syncable>(table: TableName, records: T[], origin: Origin): Promise<void> {
    for (const record of records) {
      this.table(table).set(record.id, structuredClone(record));
      if (origin === "local") {
        const key = outboxKey(table, record.id);
        this.queue.set(key, { key, table, id: record.id, updatedAt: record.updatedAt });
      }
    }
  }

  async outbox(): Promise<OutboxEntry[]> {
    return [...this.queue.values()];
  }

  async clearOutbox(entries: OutboxEntry[]): Promise<void> {
    for (const e of entries) {
      if (this.queue.get(e.key)?.updatedAt === e.updatedAt) this.queue.delete(e.key);
    }
  }

  async getMeta(key: string): Promise<string | undefined> {
    return this.meta.get(key);
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }

  private table(name: TableName): Map<string, Syncable> {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new Map()));
    return t;
  }
}
