import type { Syncable } from "../domain/ids";

/**
 * What to do with a copy of a record downloaded from the server:
 * - take: replace this device's copy with it;
 * - keep: keep this device's copy (it is newer, the same, or already waiting to upload);
 * - push: keep this device's copy and upload it again, so the server and every device end on it.
 */
export type Settle = "take" | "keep" | "push";

/**
 * The newer stamp wins. Equal stamps with different contents come from two devices repairing the
 * same late copy differently: SetupService.reconcile dates a repair 1 ms after the copy it fixes,
 * and the two devices hadn't yet heard each other's merge or delete. Such a tie is settled by the
 * copies themselves (`outranks`), never by which one reached the server last, so every device
 * settles it the same way: the losing side takes the winner, and the winner's side uploads it
 * again if the server doesn't hold it (the server accepts an equal stamp, see supabase/migrations).
 */
export function settle(remote: Syncable, local: Syncable | undefined, waitingToUpload: boolean): Settle {
  if (!local) return "take";
  const newer = Date.parse(remote.updatedAt) - Date.parse(local.updatedAt);
  if (newer !== 0) return newer > 0 ? "take" : "keep"; // NaN (a damaged stamp) keeps the local copy
  if (sameContent(remote, local)) return "keep";
  if (outranks(remote, local)) return "take";
  return waitingToUpload ? "keep" : "push";
}

/**
 * Between two different copies with one stamp, whether `a` is the one to keep. Loss-averse first:
 * the copy holding more logged sets and done / skipped answers wins (a repair that filed a late
 * log beats one that dropped it, and a deleted copy loses to a kept one), then the one with more
 * note text; then a fixed order of the contents, so any two copies compare the same way on every
 * device.
 */
export function outranks(a: Syncable, b: Syncable): boolean {
  const [ka, kb] = [held(a), held(b)];
  if (ka.entries !== kb.entries) return ka.entries > kb.entries;
  if (ka.notes !== kb.notes) return ka.notes > kb.notes;
  return comparable(a) > comparable(b);
}

/** Two copies hold the same data, whatever their key order (Postgres jsonb reorders keys) or stamp format. */
export function sameContent(a: Syncable, b: Syncable): boolean {
  return comparable(a) === comparable(b);
}

/**
 * What a session copy holds: filled sets plus answered done / not-done checks (`entries`), and
 * note characters; -1 entries for a deleted copy; nothing for other records.
 */
function held(record: Syncable): { entries: number; notes: number } {
  if (record.deleted === true) return { entries: -1, notes: 0 };
  const logs = (record as { logs?: unknown }).logs;
  let entries = 0;
  let notes = 0;
  if (Array.isArray(logs)) {
    for (const log of logs as { sets?: unknown; done?: unknown; note?: unknown }[]) {
      if (Array.isArray(log?.sets)) {
        entries += (log.sets as { weight?: unknown; reps?: unknown }[]).filter((s) => (s?.weight ?? null) !== null || (s?.reps ?? null) !== null).length;
      }
      if (log?.done === true || log?.done === false) entries += 1;
      if (typeof log?.note === "string") notes += log.note.trim().length;
    }
  }
  return { entries, notes };
}

/** The record as canonical JSON without its stamp: keys sorted, missing and undefined alike. */
function comparable(record: Syncable): string {
  return canonical({ ...record, updatedAt: null, deleted: record.deleted === true });
}

/** JSON with every object's keys sorted. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}
