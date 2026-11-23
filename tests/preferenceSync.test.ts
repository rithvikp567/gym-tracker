import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { readPreferences, reconcilePreferences } from "../src/data/preferenceSync";
import { SupabaseSync } from "../src/data/SupabaseSync";
import { EPOCH } from "../src/domain/ids";
import { SettingsService } from "../src/services/SettingsService";
import { systemClock, type Clock, type KeyValueStore, type PreferencesSnapshot } from "../src/services/ports";

/** Stand-in for Supabase: the account's user metadata, and counts of what sync asked it for. */
const supabase = vi.hoisted(() => {
  const account = {
    metadata: {} as Record<string, unknown>,
    reads: 0,
    queries: 0,
    /** While set, pulls wait for it, so a test can press Sync during a sync. */
    gate: null as Promise<void> | null,
    /** While true, reading the account fails. */
    failReads: false,
    /** While true, pulls fail with a server error. */
    failPulls: false,
    /** Runs after the account's settings are saved, so a test can act between two syncs. */
    afterUpdate: null as (() => void) | null,
  };
  let onAuth: (event: string, session: unknown) => void = () => {};
  const session = () => ({ user: { id: "me", email: "me@example.com" } });
  const query = {
    select: () => query,
    gt: () => query,
      eq: () => query,
    order: () => query,
    range: async () => {
      await account.gate;
      return account.failPulls ? { data: null, error: { message: "Internal server error" } } : { data: [], error: null };
    },
    upsert: async () => ({ error: null }),
  };
  const client = {
    auth: {
      onAuthStateChange: (callback: typeof onAuth) => void (onAuth = callback),
      getUser: async () => {
        account.reads++;
        if (account.failReads) return { data: { user: null }, error: new Error("Failed to fetch") };
        return { data: { user: { id: "me", user_metadata: structuredClone(account.metadata) } }, error: null };
      },
      updateUser: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(account.metadata, structuredClone(data));
        // Like auth-js: saving the user tells every listener before updateUser returns.
        onAuth("USER_UPDATED", session());
        account.afterUpdate?.();
        return { data: {}, error: null };
      },
    },
    from: () => {
      account.queries++;
      return query;
    },
  };
  return {
    account,
    client,
    signIn: () => onAuth("SIGNED_IN", session()),
    /** An auth event from auth-js; by default for the account already signed in. */
    emit: (event: string, about: unknown = session()) => onAuth(event, about),
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => supabase.client }));

const T0 = "2026-11-21T10:00:00.000Z";
const T1 = "2026-11-21T11:00:00.000Z";
const T2 = "2026-11-21T12:00:00.000Z";
const clock: Clock = { now: () => new Date(T0) };

const memoryStore = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
};

/** A copy with one time for everything: how every copy was saved before per-setting stamps. */
const snap = (theme: string, updatedAt: string): PreferencesSnapshot => ({ values: { theme, showLastSession: true }, updatedAt });

/** A copy with a stamp per setting. */
const stamped = ([theme, themeAt]: [string, string], [showLastSession, showAt]: [boolean, string]): PreferencesSnapshot => ({
  values: { theme, showLastSession },
  updatedAt: Date.parse(themeAt) > Date.parse(showAt) ? themeAt : showAt,
  stamps: { theme: themeAt, showLastSession: showAt },
});

/** What sync does with the two copies. */
const decide = (local: PreferencesSnapshot, remote: PreferencesSnapshot | null) => {
  const { apply, push } = reconcilePreferences(local, remote);
  return apply && push ? "apply and push" : apply ? "apply" : push ? "push" : "none";
};

describe("preference sync", () => {
  it("keeps the newest change", () => {
    expect(decide(snap("oled", T0), snap("graphite", T1))).toBe("apply");
    expect(decide(snap("graphite", T2), snap("oled", T1))).toBe("push");
    expect(reconcilePreferences(snap("graphite", T2), snap("oled", T1)).merged.values.theme).toBe("graphite");
  });

  it("uploads a real choice when the account has none, but never untouched defaults", () => {
    expect(decide(snap("graphite", T2), null)).toBe("push");
    expect(decide(snap("oled", EPOCH), null)).toBe("none");
    // The account's copy lacks a setting this device never touched: nothing worth uploading.
    expect(decide(stamped(["graphite", T1], [true, EPOCH]), { values: { theme: "graphite" }, updatedAt: T1 })).toBe("none");
  });

  it("settles ties on the account's copy and does nothing when already equal", () => {
    const old = "1970-01-01T00:00:00.001Z";
    expect(decide(snap("oled", old), snap("graphite", old))).toBe("apply");
    expect(decide(snap("oled", old), snap("oled", old))).toBe("none");
    expect(decide(snap("oled", EPOCH), snap("graphite", old))).toBe("apply");
    expect(decide(stamped(["oled", T1], [false, T2]), stamped(["graphite", T1], [false, T2]))).toBe("apply");
    // The same times written another way are still a tie.
    const sameTimes = {
      values: { theme: "oled", showLastSession: true },
      updatedAt: "2026-11-21T11:00:00Z",
      stamps: { theme: "2026-11-21T11:00:00Z", showLastSession: "2026-11-21T10:00:00Z" },
    };
    expect(decide(stamped(["oled", T1], [true, T0]), sameTimes)).toBe("none");
  });

  it("merges setting by setting, so a stale device's toggle keeps the account's newer color", () => {
    // This device still has OLED from T0 and turned off last session's numbers at T2; the phone picked Graphite at T1.
    const plan = reconcilePreferences(stamped(["oled", T0], [false, T2]), stamped(["graphite", T1], [true, T1]));
    expect(plan.merged).toEqual({ values: { theme: "graphite", showLastSession: false }, updatedAt: T2, stamps: { theme: T1, showLastSession: T2 } });
    expect(plan.apply).toBe(true);
    expect(plan.push).toBe(true);
  });

  it("dates every setting in a copy without stamps (saved by an older version) by its updatedAt", () => {
    const fromOlderPhone = reconcilePreferences(stamped(["oled", T0], [false, T2]), snap("graphite", T1));
    expect(fromOlderPhone.merged.values).toEqual({ theme: "graphite", showLastSession: false });
    expect(decide(stamped(["oled", T0], [false, T2]), snap("graphite", T1))).toBe("apply and push");
    const onOlderCopy = reconcilePreferences(snap("graphite", T1), stamped(["oled", T0], [false, T2]));
    expect(onOlderCopy.merged.values).toEqual({ theme: "graphite", showLastSession: false });
    expect(decide(snap("graphite", T1), stamped(["oled", T0], [false, T2]))).toBe("apply and push");
  });

  it("lets a change made after adopting a copy from a clock that runs ahead outrank that copy", () => {
    const ahead = new Date(Date.parse(T0) + 3_600_000).toISOString(); // the desktop's clock is an hour fast
    const desktop = { values: { theme: "graphite", showLastSession: true }, updatedAt: ahead, stamps: { theme: ahead, showLastSession: ahead } };
    const phone = new SettingsService(memoryStore(), clock);
    phone.applyRemote(desktop);
    phone.update({ theme: "oled" });
    const plan = reconcilePreferences(phone.snapshot(), desktop);
    expect(decide(phone.snapshot(), desktop)).toBe("push");
    expect(plan.merged.values.theme).toBe("oled");
  });

  it("passes along settings this version doesn't know, without re-applying them every time", () => {
    const newer = { values: { theme: "graphite", showLastSession: true, units: "kg" }, updatedAt: T1 };
    const plan = reconcilePreferences(stamped(["oled", T0], [false, T2]), newer);
    expect(plan.merged.values).toEqual({ theme: "graphite", showLastSession: false, units: "kg" });
    const settings = new SettingsService(memoryStore(), clock);
    settings.applyRemote(plan.merged);
    expect(decide(settings.snapshot(), plan.merged)).toBe("none");
  });

  it("reads only well-formed snapshots from the account, and drops stamps that aren't times", () => {
    expect(readPreferences({ values: { theme: "oled" }, updatedAt: "2026-11-21T10:00:00Z" })).not.toBeNull();
    expect(readPreferences(undefined)).toBeNull();
    expect(readPreferences({ values: ["oled"], updatedAt: "2026-11-21T10:00:00Z" })).toBeNull();
    expect(readPreferences({ values: {}, updatedAt: "not a date" })).toBeNull();
    expect(readPreferences("oled")).toBeNull();
    const values = { theme: "graphite", showLastSession: false };
    const damaged = { values, updatedAt: T1, stamps: { theme: T0, showLastSession: "soon", junk: T1 } };
    expect(readPreferences(damaged)).toEqual({ values, updatedAt: T1, stamps: { theme: T0 } });
    expect(readPreferences({ values, updatedAt: T1, stamps: ["T0"] })?.stamps).toEqual({});
    expect(readPreferences({ values, updatedAt: T1 })?.stamps).toEqual({});
  });
});

describe("SupabaseSync preferences", () => {
  const start = Date.parse(T0);
  const iso = (ms: number) => new Date(ms).toISOString();
  const accountPrefs = () => supabase.account.metadata.gym_tracker_prefs as PreferencesSnapshot | undefined;
  /** The phone uploads its copy (stamps in ms). */
  const phoneSaves = (theme: string, showLastSession: boolean, stamps: { theme: number; showLastSession: number }) => {
    supabase.account.metadata.gym_tracker_prefs = {
      values: { theme, showLastSession },
      updatedAt: iso(Math.max(stamps.theme, stamps.showLastSession)),
      stamps: { theme: iso(stamps.theme), showLastSession: iso(stamps.showLastSession) },
    };
  };
  /** Lets timers and promise chains finish (everything here resolves at once). */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  let settings: SettingsService;
  let sync: SupabaseSync;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("navigator", { onLine: true });
    Object.assign(supabase.account, { metadata: {}, reads: 0, queries: 0, gate: null, failReads: false, failPulls: false, afterUpdate: null });
    settings = new SettingsService(memoryStore(), systemClock);
    sync = new SupabaseSync(supabase.client as never, new MemoryRecordStore(), () => {});
    sync.attachPreferences(settings);
    supabase.signIn();
    await settle(); // signing in syncs once, which reads the account's settings
    expect(supabase.account.reads).toBe(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("re-reads the account's settings when you press Sync, even right after a check", async () => {
    phoneSaves("graphite", true, { theme: start + 5_000, showLastSession: 0 });
    vi.setSystemTime(start + 10_000);
    sync.requestSync(0);
    await settle();
    expect(supabase.account.reads).toBe(1); // automatic syncs re-read at most once a minute
    expect(settings.get().theme).toBe("oled");
    await sync.syncNow();
    expect(supabase.account.reads).toBe(2);
    expect(settings.get().theme).toBe("graphite");
  });

  it("when you press Sync during a sync, finishes only after a sync that read the account's settings", async () => {
    let release = () => {};
    supabase.account.gate = new Promise((resolve) => (release = resolve));
    vi.setSystemTime(start + 10_000);
    sync.requestSync(0);
    await settle(); // that sync is now waiting on the server
    phoneSaves("graphite", true, { theme: start + 5_000, showLastSession: 0 });
    let finished = false;
    const pressed = sync.syncNow().then(() => (finished = true));
    await settle();
    expect(finished).toBe(false);
    supabase.account.gate = null;
    release();
    await pressed;
    expect(supabase.account.reads).toBe(2);
    expect(settings.get().theme).toBe("graphite");
    expect(sync.status().state).toBe("idle");
  });

  it("checks the account's settings when the window gets focus, at most every 15 s, without a full sync", async () => {
    const { queries } = supabase.account;
    const status = sync.status();
    phoneSaves("graphite", true, { theme: start + 1_000, showLastSession: 0 });
    vi.setSystemTime(start + 5_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(supabase.account.reads).toBe(1); // read 5 s ago, when signing in
    vi.setSystemTime(start + 20_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(supabase.account.reads).toBe(2);
    expect(settings.get().theme).toBe("graphite");
    expect(supabase.account.queries).toBe(queries); // no push or pull
    expect(sync.status()).toBe(status); // still "Synced at" the last full sync
    vi.setSystemTime(start + 30_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(supabase.account.reads).toBe(2);
  });

  it("doesn't retry a failed focus check on every focus, and leaves the read to the next sync", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    supabase.account.failReads = true;
    vi.setSystemTime(start + 20_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(supabase.account.reads).toBe(2);
    expect(warn).toHaveBeenCalledOnce();
    supabase.account.failReads = false;
    phoneSaves("graphite", true, { theme: start + 10_000, showLastSession: 0 });
    vi.setSystemTime(start + 25_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(supabase.account.reads).toBe(2);
    sync.requestSync(0);
    await settle();
    expect(supabase.account.reads).toBe(3);
    expect(settings.get().theme).toBe("graphite");
  });

  it("keeps checking on focus after the clock is turned back", async () => {
    vi.setSystemTime(start + 20_000);
    window.dispatchEvent(new Event("focus")); // the sign-in check and this one ran while the clock was 5 h fast
    await settle();
    expect(supabase.account.reads).toBe(2);
    const corrected = start - 5 * 3_600_000;
    phoneSaves("graphite", true, { theme: corrected + 1_000, showLastSession: 0 });
    vi.setSystemTime(corrected + 2_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(supabase.account.reads).toBe(3);
    expect(settings.get().theme).toBe("graphite");
    vi.setSystemTime(corrected + 10_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(supabase.account.reads).toBe(3); // throttled again, by the corrected clock
  });

  it("re-reads on the next automatic sync after the clock is turned back", async () => {
    const corrected = start - 5 * 3_600_000; // the sign-in check ran while the clock was 5 h fast
    phoneSaves("graphite", true, { theme: corrected + 1_000, showLastSession: 0 });
    vi.setSystemTime(corrected + 2_000);
    sync.requestSync(0);
    await settle();
    expect(supabase.account.reads).toBe(2);
    expect(settings.get().theme).toBe("graphite");
    vi.setSystemTime(corrected + 30_000);
    sync.requestSync(0);
    await settle();
    expect(supabase.account.reads).toBe(2); // once a minute again, by the corrected clock
  });

  it("doesn't hide a failed sync when a focus check uploads a setting", async () => {
    supabase.account.failPulls = true;
    settings.update({ theme: "graphite" });
    await settle();
    const failed = sync.status();
    expect(failed).toMatchObject({ state: "error", message: "Sync failed: Internal server error" });
    expect(accountPrefs()).toBeUndefined(); // the sync failed before it got to the settings
    vi.setSystemTime(start + 20_000);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(accountPrefs()?.values.theme).toBe("graphite");
    expect(sync.status()).toBe(failed); // still "Sync failed": no records synced
  });

  it("shows a sync queued by the Sync button as syncing until it ends, after one that uploaded a setting", async () => {
    let release = () => {};
    supabase.account.gate = new Promise((resolve) => (release = resolve));
    settings.update({ theme: "graphite" });
    await settle(); // that sync is now waiting on the server
    const pressed = sync.syncNow();
    let releaseQueued = () => {};
    // Once the first sync has uploaded the color, the queued one waits on the server.
    supabase.account.afterUpdate = () => (supabase.account.gate = new Promise((resolve) => (releaseQueued = resolve)));
    release();
    await settle();
    expect(accountPrefs()?.values.theme).toBe("graphite");
    expect(sync.status().state).toBe("syncing");
    supabase.account.gate = null;
    releaseQueued();
    await pressed;
    expect(sync.status()).toMatchObject({ state: "idle", message: null });
  });

  it("stays signed out when you sign out while a sync runs, whether that sync ends well or not", async () => {
    for (const fails of [false, true]) {
      supabase.signIn();
      await settle();
      let release = () => {};
      supabase.account.gate = new Promise((resolve) => (release = resolve));
      supabase.account.failPulls = fails;
      sync.requestSync(0);
      await settle(); // waiting on the server
      expect(sync.status().state).toBe("syncing");
      supabase.emit("SIGNED_OUT", null);
      await settle();
      supabase.account.gate = null;
      release();
      await settle();
      expect(sync.status()).toMatchObject({ state: "signed-out", email: null, message: null });
    }
  });

  it("resets the sync status only when the account changes, not on a token refresh or a tab back in front", async () => {
    supabase.account.failPulls = true;
    sync.requestSync(0);
    await settle();
    const failed = sync.status();
    expect(failed.state).toBe("error");
    supabase.emit("TOKEN_REFRESHED");
    supabase.emit("SIGNED_IN"); // auth-js says this again whenever the tab comes back to the front
    await settle();
    expect(sync.status()).toBe(failed);
    supabase.emit("USER_UPDATED", { user: { id: "me", email: "new@example.com" } });
    await settle();
    expect(sync.status()).toEqual({ ...failed, email: "new@example.com" });
    supabase.emit("SIGNED_OUT", null);
    await settle();
    expect(sync.status()).toMatchObject({ state: "signed-out", email: null, message: null });
  });

  it("keeps a change made after adopting a copy stamped by a clock that runs ahead", async () => {
    const ahead = start + 3_600_000;
    phoneSaves("graphite", true, { theme: ahead, showLastSession: ahead });
    vi.setSystemTime(start + 61_000);
    sync.requestSync(0);
    await settle();
    expect(settings.get().theme).toBe("graphite");
    vi.setSystemTime(start + 120_000);
    settings.update({ theme: "oled" });
    await settle();
    expect(settings.get().theme).toBe("oled");
    expect(accountPrefs()?.values.theme).toBe("oled");
  });

  it("uploads a stale window's toggle without undoing the color another device picked", async () => {
    settings.update({ theme: "oled" }); // this window picked OLED at T0 and uploaded it
    await settle();
    phoneSaves("graphite", true, { theme: start + 10_000, showLastSession: 0 }); // the phone picks Graphite at T1
    vi.setSystemTime(start + 20_000);
    settings.update({ showLastSession: false }); // this window, still showing OLED, toggles at T2
    await settle();
    expect(settings.get()).toMatchObject({ theme: "graphite", showLastSession: false });
    expect(accountPrefs()?.values).toMatchObject({ theme: "graphite", showLastSession: false });
  });

  it("brings a custom theme, accent, recent colors, the Progress unit and the rest timer length picked on the phone to this device", async () => {
    const at = iso(start + 5_000);
    const values = {
      theme: "custom",
      customThemeColor: "#1e2a44",
      accent: "custom",
      customAccentColor: "#ff6a3dcc",
      recentThemeColors: ["#1e2a44", "#3b2f4a"],
      recentAccentColors: ["#ff6a3dcc"],
      showLastSession: true,
      progressUnit: "kg",
      restSeconds: 120,
    };
    const keys = ["theme", "customThemeColor", "accent", "customAccentColor", "recentThemeColors", "recentAccentColors", "progressUnit", "restSeconds"];
    supabase.account.metadata.gym_tracker_prefs = { values, updatedAt: at, stamps: Object.fromEntries(keys.map((k) => [k, at])) };
    await sync.syncNow();
    expect(settings.get()).toEqual(values);
  });

  it("uploads a custom look picked here, setting by setting", async () => {
    vi.setSystemTime(start + 30_000);
    settings.update({ theme: "custom", customThemeColor: "#f4e9d8", recentThemeColors: ["#f4e9d8"] });
    await settle();
    expect(accountPrefs()?.values).toMatchObject({ theme: "custom", customThemeColor: "#f4e9d8", recentThemeColors: ["#f4e9d8"] });
    expect(accountPrefs()?.stamps).toMatchObject({ theme: iso(start + 30_000), customThemeColor: iso(start + 30_000) });
    // The phone then picks an accent: this device takes it without losing its theme.
    const phoneAt = iso(start + 40_000);
    const account = accountPrefs()!;
    supabase.account.metadata.gym_tracker_prefs = {
      values: { ...account.values, accent: "purple" },
      updatedAt: phoneAt,
      stamps: { ...account.stamps, accent: phoneAt },
    };
    await sync.syncNow();
    expect(settings.get()).toMatchObject({ theme: "custom", customThemeColor: "#f4e9d8", accent: "purple" });
  });
});
