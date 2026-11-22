import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import type { TableName } from "../src/data/RecordStore";
import { SupabaseSync } from "../src/data/SupabaseSync";
import type { Syncable } from "../src/domain/ids";

/**
 * Stand-in for Supabase's tables: upserts keep the newer copy and accept an equal stamp (the
 * keep_newest trigger in supabase/migrations), and every write gets a later server time, which
 * pulls page through.
 */
const server = vi.hoisted(() => {
  interface Row {
    id: string;
    data: Record<string, unknown>;
    updated_at: string;
    deleted: boolean;
    server_updated_at: string;
  }
  const tables = new Map<string, Map<string, Row>>();
  let clock = Date.parse("2026-11-18T09:00:00.000Z");
  let onAuth: (event: string, session: unknown) => void = () => {};
  const table = (name: string) => tables.get(name) ?? tables.set(name, new Map()).get(name)!;
  const query = (name: string) => {
    let since = "";
    const q = {
      select: () => q,
      gt: (_column: string, value: string) => ((since = value), q),
      order: () => q,
      range: async (from: number, to: number) => {
        const rows = [...table(name).values()]
          .filter((r) => r.server_updated_at > since)
          .sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : a.server_updated_at > b.server_updated_at ? 1 : 0));
        return { data: structuredClone(rows.slice(from, to + 1)), error: null };
      },
      upsert: async (rows: Omit<Row, "server_updated_at">[]) => {
        for (const row of rows) {
          const held = table(name).get(row.id);
          if (held && Date.parse(row.updated_at) < Date.parse(held.updated_at)) continue;
          table(name).set(row.id, { ...structuredClone(row), server_updated_at: new Date(++clock).toISOString() });
        }
        return { error: null };
      },
    };
    return q;
  };
  const client = {
    auth: {
      onAuthStateChange: (callback: typeof onAuth) => void (onAuth = callback),
      getUser: async () => ({ data: { user: { id: "me", user_metadata: {} } }, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
    from: (name: string) => query(name),
  };
  return {
    client,
    tables,
    signIn: () => onAuth("SIGNED_IN", { user: { id: "me", email: "me@example.com" } }),
    /** A copy another device uploaded. */
    put(name: string, record: Syncable) {
      table(name).set(record.id, {
        id: record.id,
        data: structuredClone(record) as unknown as Record<string, unknown>,
        updated_at: record.updatedAt,
        deleted: record.deleted,
        server_updated_at: new Date(++clock).toISOString(),
      });
    },
    get: (name: string, id: string) => table(name).get(id)?.data,
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => server.client }));

const T = "2026-11-18T08:00:00.002Z";
const ID = "lower:2026-11-18";
const session = (updatedAt: string, logs: unknown[]): Syncable & { logs: unknown[] } => ({
  id: ID,
  workoutDayId: "lower",
  date: "2026-11-18",
  logs,
  updatedAt,
  deleted: false,
} as Syncable & { logs: unknown[] });
/** Two repairs of one late copy, one stamp: the late Legpress set filed under Leg Press, or dropped. */
const filed = session(T, [{ exerciseId: "press", sets: [{ weight: 300, reps: 10 }, { weight: 320, reps: 10 }], done: null, note: "" }]);
const dropped = session(T, [{ exerciseId: "press", sets: [{ weight: 300, reps: 10 }], done: null, note: "" }]);

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("SupabaseSync records", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("navigator", { onLine: true });
    server.tables.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function signedIn(store: MemoryRecordStore): Promise<SupabaseSync> {
    const sync = new SupabaseSync("https://example.supabase.co", "key", store, () => {});
    server.signIn();
    await settle(); // signing in syncs once
    return sync;
  }

  it("uploads this device's copy again when it wins a tie the server lost, so every copy ends on it", async () => {
    const store = new MemoryRecordStore();
    await store.putMany("sessions", [filed], "remote"); // synced earlier: not waiting to upload
    server.put("sessions", dropped); // the other repair reached the server last
    await signedIn(store);
    expect(server.get("sessions", ID)).toMatchObject({ logs: filed.logs });
    expect(await store.get("sessions", ID)).toMatchObject({ logs: filed.logs, updatedAt: T });
    expect(await store.outbox()).toEqual([]);
  });

  it("takes the server's copy when it wins the tie", async () => {
    const store = new MemoryRecordStore();
    await store.putMany("sessions", [dropped], "remote");
    server.put("sessions", filed);
    await signedIn(store);
    expect(await store.get("sessions", ID)).toMatchObject({ logs: filed.logs });
    expect(server.get("sessions", ID)).toMatchObject({ logs: filed.logs });
  });

  it("never queues the tie's copy over a save that lands while the pull runs", async () => {
    const later = session("2026-11-18T10:00:00.000Z", [...filed.logs, { exerciseId: "squat", sets: [{ weight: 225, reps: 5 }], done: null, note: "" }]);
    /** Saves `later` right after the pull reads this device's copy of the session. */
    class SaveDuringPull extends MemoryRecordStore {
      armed = false;
      override async get<R extends Syncable>(table: TableName, id: string): Promise<R | undefined> {
        const copy = await super.get<R>(table, id);
        if (this.armed && table === "sessions" && id === ID) {
          this.armed = false;
          await this.putMany("sessions", [later], "local");
        }
        return copy;
      }
    }
    const store = new SaveDuringPull();
    await store.putMany("sessions", [filed], "remote");
    server.put("sessions", dropped);
    store.armed = true;
    const sync = await signedIn(store);
    // The save stays, waiting to upload, and goes up on the next sync.
    expect(await store.get("sessions", ID)).toMatchObject({ updatedAt: later.updatedAt, logs: later.logs });
    expect((await store.outbox()).map((e) => e.updatedAt)).toEqual([later.updatedAt]);
    await sync.syncNow();
    expect(server.get("sessions", ID)).toMatchObject({ updatedAt: later.updatedAt, logs: later.logs });
    expect(await store.outbox()).toEqual([]);
  });
});
