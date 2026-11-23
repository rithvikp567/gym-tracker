import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { NoSocial } from "../src/data/NoSocial";
import { NoSync } from "../src/data/NoSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { BackupService } from "../src/services/BackupService";
import { CalendarService } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import type { SyncController } from "../src/services/ports";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { SettingsService } from "../src/services/SettingsService";
import { SocialService } from "../src/services/SocialService";
import { TimerService } from "../src/services/TimerService";
import { SetupService } from "../src/services/SetupService";
import { setViewState } from "../src/ui/hooks/useViewState";
import { APPEARANCE_OPEN, SettingsScreen } from "../src/ui/screens/settings/SettingsScreen";
import { ServicesProvider } from "../src/ui/ServicesContext";

/* Settings rendered once on the server (no effects), with sync set up and signed in. */

function makeServices(email: string | null = "someone@example.com"): AppServices {
  const clock = { now: () => new Date(2026, 10, 20, 12) };
  const repos = new StoreRepositories(new MemoryRecordStore(), clock);
  const prefs = new Map<string, string>();
  const deviceStore = { get: (k: string) => prefs.get(k) ?? null, set: (k: string, v: string) => void prefs.set(k, v) };
  const settings = new SettingsService(deviceStore, clock);
  const sync: SyncController = Object.assign(new NoSync(), {
    configured: true,
    status: () => ({ state: "idle" as const, email, lastSyncedAt: null, message: null }),
  });
  return {
    mode: "device",
    changes: repos.changes,
    setup: new SetupService(repos),
    sessions: new SessionService(repos),
    calendar: new CalendarService(repos, clock),
    progress: new ProgressService(repos, clock),
    imports: new ImportService(repos),
    backup: new BackupService(repos),
    settings,
    sync,
    social: new SocialService(new NoSocial(), repos, clock),
    timer: new TimerService(deviceStore, settings, clock),
  };
}

const render = (services: AppServices) => renderToString(createElement(ServicesProvider, { services, children: createElement(SettingsScreen) }));

describe("Settings screen", () => {
  beforeEach(() => {
    // The install card asks what kind of device this is: a computer, so it stays hidden.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: fine") }));
    vi.stubGlobal("navigator", { userAgent: "node", platform: "Linux", maxTouchPoints: 0 });
    // Appearance is a drop-down; most tests here look inside it.
    setViewState(APPEARANCE_OPEN, true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists Account and sync, then Workouts, then Appearance", () => {
    const titles = [...render(makeServices()).matchAll(/<div class="section-title">([^<]+)<\/div>/g)].map((m) => m[1]);
    expect(titles).toEqual(["Account and sync", "Workouts", "Appearance"]);
  });

  it("folds Appearance under a \"Theme and Accent Color\" drop-down, closed at first, with no grey sub text", () => {
    setViewState(APPEARANCE_OPEN, false);
    const services = makeServices();
    services.settings.update({ theme: "sand", accent: "teal" });
    const html = render(services);
    expect(html).toMatch(/<section class="card day-card" aria-label="Appearance"><button type="button" class="day-card-head" aria-expanded="false"/);
    expect(html).toContain('<span class="title">Theme and Accent Color</span></span>');
    expect(html.slice(html.indexOf('aria-label="Appearance"'))).not.toContain('class="meta"');
    expect(html).not.toContain('role="radio"'); // no swatches or theme tiles until it's opened
    setViewState(APPEARANCE_OPEN, true);
    const open = render(services);
    expect(open).toMatch(/class="card day-card open" aria-label="Appearance"><button type="button" class="day-card-head" aria-expanded="true"/);
    expect(open).toMatch(/<div class="day-card-body" id="appearance-body"><div class="look">/); // no card inside the card
    expect([...open.matchAll(/role="radio"/g)]).toHaveLength(16);
  });

  it("shows the accent swatches and theme tiles, with the current ones picked and named", () => {
    const html = render(makeServices());
    const radios = [...html.matchAll(/role="radio"[^>]*aria-checked="(true|false)"/g)];
    expect(radios).toHaveLength(9 + 7); // 8 accents + Custom, 6 themes + Custom
    expect(html).toMatch(/data-accent="lime" aria-checked="true"/);
    expect(html).toMatch(/aria-checked="true"><span class="theme-mini" data-theme="oled"/);
    expect(html).toContain('<span class="look-value" aria-hidden="true">Lime</span>');
    expect(html).toContain('<span class="look-value" aria-hidden="true">OLED</span>');
    expect(html).not.toContain("Match device");
  });

  it("labels the Custom theme tile just \"Custom\" (no hex, no \"Any color\") and paints its preview from the color", () => {
    const services = makeServices();
    services.settings.update({ theme: "custom", customThemeColor: "#1e2a44" });
    const html = render(services);
    expect(html).toContain('<span class="look-value" aria-hidden="true">Custom</span>');
    expect(html).toMatch(/is-custom is-set" aria-checked="true"[^>]*aria-label="Custom theme"/);
    expect(html).toMatch(/aria-label="Custom theme">.*<span class="theme-name">Custom<\/span><\/button>/);
    expect(html).not.toMatch(/#1E2A44|Any color/);
    expect(html).toContain("--bg:#1e2a44");
    // Before any custom color: still just "Custom".
    expect(render(makeServices())).not.toContain("Any color");
  });

  it("no longer says where the look is saved", () => {
    for (const email of ["someone@example.com", null]) {
      const html = render(makeServices(email));
      expect(html).not.toMatch(/Saved to your account|Sign in to use the same style|Saved on this device/);
    }
  });

  it("lists the Workouts rows by title alone", () => {
    const html = render(makeServices());
    const workouts = html.slice(html.indexOf(">Workouts<"), html.indexOf(">Appearance<"));
    for (const title of ["Workout Days and Split", "Import from Google Sheets", "Download a backup"]) expect(workouts).toContain(title);
    expect(workouts).not.toContain('class="meta"');
  });

  it("puts a small Sign out beside Sync, on the email's row", () => {
    const html = render(makeServices("someone@example.com"));
    const row = html.slice(html.indexOf('class="setting account-row"'));
    expect(row).toMatch(/someone@<wbr\/>example\.com/);
    const actions = row.slice(row.indexOf('class="account-actions"'));
    expect(actions.indexOf("Sign out")).toBeGreaterThan(0);
    expect(actions.indexOf("Sync")).toBeGreaterThan(actions.indexOf("Sign out"));
    expect(html).not.toContain('class="btn ghost"'); // the old full-width Sign out
  });
});
