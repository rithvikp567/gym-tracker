export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Plain-http pages (testing on a phone over Wi-Fi) don't get randomUUID; build a v4 UUID by hand.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Something that has been saved: every stored record carries these for sync. */
export interface Syncable {
  id: string;
  /** ISO timestamp of the last local change; the newest write wins during sync. */
  updatedAt: string;
  /** Soft delete, so deletions sync to other devices. */
  deleted: boolean;
}

export const EPOCH = "1970-01-01T00:00:00.000Z";
