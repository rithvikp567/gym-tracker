import type { PreferencesSnapshot } from "../services/ports";

/**
 * How to bring this device's preferences and the account's copy together. Settings merge one
 * by one: each comes from the copy that changed it last, and ties go to the account, so two
 * devices with old, untimed choices settle on one value.
 */
export interface PreferencePlan {
  /** What both copies should hold. */
  merged: PreferencesSnapshot;
  /** The account's copy had something newer: apply `merged` on this device. */
  apply: boolean;
  /** This device had something newer, or the account has no copy yet: upload `merged`. Untouched defaults are never uploaded on their own. */
  push: boolean;
}

interface Setting {
  value: unknown;
  /** When it last changed (ms). */
  at: number;
}

export function reconcilePreferences(local: PreferencesSnapshot, remote: PreferencesSnapshot | null): PreferencePlan {
  const merged = new Map<string, Setting>();
  let apply = false;
  let push = false;
  for (const key of new Set([...Object.keys(local.values), ...Object.keys(remote?.values ?? {})])) {
    const mine = setting(local, key);
    const theirs = remote ? setting(remote, key) : undefined;
    if (theirs && (!mine || theirs.at >= mine.at)) {
      merged.set(key, theirs);
      if (mine && !same(mine, theirs)) apply = true;
    } else if (mine) {
      merged.set(key, mine);
      if (theirs || mine.at > 0) push = true;
    }
  }
  const entries = [...merged];
  const newest = Math.max(0, ...entries.map(([, s]) => s.at));
  return {
    merged: {
      values: Object.fromEntries(entries.map(([key, s]) => [key, s.value])),
      updatedAt: new Date(newest).toISOString(),
      stamps: Object.fromEntries(entries.map(([key, s]) => [key, new Date(s.at).toISOString()])),
    },
    apply,
    push,
  };
}

/**
 * The account's snapshot from user metadata, or null when missing or malformed. Stamps that
 * aren't times, or that name no setting in `values`, are dropped (the copy's time stands in).
 */
export function readPreferences(raw: unknown): PreferencesSnapshot | null {
  if (!isRecord(raw)) return null;
  const { values, updatedAt, stamps } = raw;
  if (!isRecord(values) || typeof updatedAt !== "string" || timeOf(updatedAt) === undefined) return null;
  const valid = isRecord(stamps)
    ? Object.entries(stamps).filter(
        (e): e is [string, string] => Object.hasOwn(values, e[0]) && typeof e[1] === "string" && timeOf(e[1]) !== undefined,
      )
    : [];
  return { values, updatedAt, stamps: Object.fromEntries(valid) };
}

/** A setting in one copy, dated by its own stamp, else by the copy's time (copies saved before per-setting stamps). */
function setting(snapshot: PreferencesSnapshot, key: string): Setting | undefined {
  if (!Object.hasOwn(snapshot.values, key)) return undefined;
  return { value: snapshot.values[key], at: timeOf(snapshot.stamps?.[key]) ?? timeOf(snapshot.updatedAt) ?? 0 };
}

function same(a: Setting, b: Setting): boolean {
  return a.at === b.at && (a.value === b.value || JSON.stringify(a.value) === JSON.stringify(b.value));
}

function timeOf(value: unknown): number | undefined {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
