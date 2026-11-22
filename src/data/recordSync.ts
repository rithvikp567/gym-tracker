import type { Syncable } from "../domain/ids";

/**
 * Whether a copy downloaded from the server replaces this device's copy of a record.
 *
 * The newer stamp wins. Equal stamps with different contents come from two devices repairing
 * the same late copy differently: SetupService.reconcile dates a repair 1 ms after the copy it
 * fixes, and the two devices hadn't yet heard each other's merge or delete. The server keeps the
 * last copy uploaded (equal stamps are accepted, see supabase/migrations), so taking it puts
 * every device on one copy. This device's own copy stays while it waits to upload: it goes up
 * on the next push, becomes the server's copy, and the other devices take it the same way.
 */
export function takesRemote(remote: Syncable, local: Syncable | undefined, waitingToUpload: boolean): boolean {
  if (!local) return true;
  const newer = Date.parse(remote.updatedAt) - Date.parse(local.updatedAt);
  if (newer !== 0) return newer > 0; // NaN (a damaged stamp) keeps the local copy
  return !waitingToUpload && !sameContent(remote, local);
}

/** Two copies hold the same data, whatever their key order (Postgres jsonb reorders keys) or stamp format. */
export function sameContent(a: Syncable, b: Syncable): boolean {
  const comparable = (r: Syncable) => canonical({ ...r, updatedAt: null, deleted: r.deleted === true });
  return comparable(a) === comparable(b);
}

/** JSON with every object's keys sorted. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}
