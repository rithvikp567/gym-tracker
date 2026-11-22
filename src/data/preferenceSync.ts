import type { PreferencesSnapshot } from "../services/ports";

/**
 * What to do with this device's preferences given the account's copy:
 *   adopt – the account's copy is newer (or the same age but different): apply it here
 *   push  – this device changed them more recently (or the account has none): upload
 *   none  – already the same, or both are untouched defaults
 * Ties go to the account, so two devices with old, untimed choices settle on one value.
 */
export type PreferenceAction = "adopt" | "push" | "none";

export function reconcilePreferences(local: PreferencesSnapshot, remote: PreferencesSnapshot | null): PreferenceAction {
  const localAt = Date.parse(local.updatedAt);
  if (remote && Date.parse(remote.updatedAt) >= localAt) {
    return remote.updatedAt !== local.updatedAt || !sameValues(remote.values, local.values) ? "adopt" : "none";
  }
  return localAt > 0 ? "push" : "none";
}

/** The account's snapshot from user metadata, or null when missing or malformed. */
export function readPreferences(raw: unknown): PreferencesSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const { values, updatedAt } = raw as Partial<PreferencesSnapshot>;
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) return null;
  return { values: values as Record<string, unknown>, updatedAt };
}

function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);
}
