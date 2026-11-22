import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { NoSync } from "../src/data/NoSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
import { BackupService } from "../src/services/BackupService";
import { CalendarService } from "../src/services/CalendarService";
import { ImportService } from "../src/services/ImportService";
import type { SyncController } from "../src/services/ports";
import { ProgressService } from "../src/services/ProgressService";
import { SessionService } from "../src/services/SessionService";
import { SettingsService } from "../src/services/SettingsService";
import { SetupService } from "../src/services/SetupService";
import { SettingsScreen } from "../src/ui/screens/settings/SettingsScreen";
import { ServicesProvider } from "../src/ui/ServicesContext";

/* Settings rendered once on the server (no effects), with sync set up and signed in. */

function makeServices(email: string | null = "someone@example.com"): AppServices {
  const clock = { now: () => new Date(2026, 10, 20, 12) };
  const repos = new StoreRepositories(new MemoryRecordStore(), clock);
  const prefs = new Map<string, string>();
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
    settings: new SettingsService({ get: (k) => prefs.get(k) ?? null, set: (k, v) => void prefs.set(k, v) }, clock),
    sync,
  };
}

const render = (services: AppServices) => renderToString(createElement(ServicesProvider, { services, children: createElement(SettingsScreen) }));

describe("Settings screen", () => {
  beforeEach(() => {
    // The install card asks what kind of device this is: a computer, so it stays hidden.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: fine") }));
    vi.stubGlobal("navigator", { userAgent: "node", platform: "Linux", maxTouchPoints: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

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

  it("names a Custom theme by its color and paints its preview from it", () => {
    const services = makeServices();
    services.settings.update({ theme: "custom", customThemeColor: "#1e2a44" });
    const html = render(services);
    expect(html).toContain('<span class="look-value" aria-hidden="true">Custom</span>');
    expect(html).toMatch(/is-custom is-set" aria-checked="true"[^>]*aria-label="Custom theme"/);
    expect(html).toContain("#1E2A44");
    expect(html).toContain("--bg:#1e2a44");
  });

  it("no longer says where the look is saved", () => {
    for (const email of ["someone@example.com", null]) {
      const html = render(makeServices(email));
      expect(html).not.toMatch(/Saved to your account|Sign in to use the same style|Saved on this device/);
    }
  });

  it("lists the Workouts rows by title alone", () => {
    const html = render(makeServices());
    const workouts = html.slice(html.indexOf(">Workouts<"), html.indexOf(">Account and sync<"));
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
