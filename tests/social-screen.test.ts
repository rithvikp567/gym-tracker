import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { DEMO_ME, seedDemoSocial } from "../src/app/demoData";
import { MemoryRecordStore } from "../src/data/MemoryRecordStore";
import { NoSocial } from "../src/data/NoSocial";
import { NoSync } from "../src/data/NoSync";
import { StoreRepositories } from "../src/data/StoreRepositories";
import type { SocialGateway, SyncController } from "../src/services/ports";
import { SettingsService } from "../src/services/SettingsService";
import { SocialService } from "../src/services/SocialService";
import { AccountCard } from "../src/ui/screens/settings/AccountCard";
import { FriendsList, Requests } from "../src/ui/screens/social/FriendsSection";
import { RoomsList } from "../src/ui/screens/social/RoomsSection";
import { SocialScreen } from "../src/ui/screens/social/SocialScreen";
import { ServicesProvider } from "../src/ui/ServicesContext";

const clock = { now: () => new Date(2026, 10, 20, 12) }; // Fri Nov 20, 2026

function services(gateway: SocialGateway, options: { email?: string | null; mode?: AppServices["mode"] } = {}): AppServices {
  const repos = new StoreRepositories(new MemoryRecordStore(), clock);
  const sync: SyncController = Object.assign(new NoSync(), {
    configured: true,
    status: () => ({ state: options.email ? ("idle" as const) : ("signed-out" as const), email: options.email ?? null, lastSyncedAt: null, message: null }),
  });
  const prefs = new Map<string, string>();
  return {
    mode: options.mode ?? "device",
    changes: repos.changes,
    settings: new SettingsService({ get: (k) => prefs.get(k) ?? null, set: (k, v) => void prefs.set(k, v) }, clock),
    sync,
    social: new SocialService(gateway, repos, clock),
  } as AppServices;
}

const render = (s: AppServices, node: ReactNode) => renderToString(createElement(ServicesProvider, { services: s, children: node })).replaceAll("<!-- -->", "");

describe("Social screen", () => {
  it("says when there's no backend, and asks you to sign in before anything else", () => {
    expect(render(services(new NoSocial()), createElement(SocialScreen))).toContain("Social needs sync, which isn&#x27;t set up for this site.");
    const signedOut = render(services(seedDemoSocial(clock)), createElement(SocialScreen));
    expect(signedOut).toContain("Sign in to add friends and compete in rooms.");
    expect(signedOut).toContain('href="#/settings"');
    // Signed in: the page loads (first frame) instead.
    expect(render(services(seedDemoSocial(clock), { email: "me@example.com" }), createElement(SocialScreen))).toContain('class="loading"');
  });

  it("lists requests and room invites, friends with this week's score, requests you sent, and rooms with your place", async () => {
    const s = services(seedDemoSocial(clock), { mode: "demo" });
    const overview = await s.social.overview();
    const requests = render(s, createElement(Requests, { overview }));
    expect(requests).toContain("Jordan");
    expect(requests).toContain("@jdawg");
    expect(requests).toContain("Leg day club");
    expect(requests).toContain("Invite from Chris");
    expect(requests.match(/>Accept</g)).toHaveLength(1);
    expect(requests.match(/>Join</g)).toHaveLength(1);

    const friends = render(s, createElement(FriendsList, { overview }));
    expect(friends).toContain('aria-label="Friend&#x27;s username"');
    for (const name of ["Alex", "Maya", "Chris"]) expect(friends).toContain(`aria-label="${name}"`);
    expect(friends).toContain('<span class="score num" title="Planned workouts done this week">5/5</span>'); // Alex, Friday
    expect(friends).toContain("@sam_lifts");
    expect(friends).toContain(">Requested<");
    // No friends yet: just the box to add one, with no grey line under it.
    const none = render(s, createElement(FriendsList, { overview: { ...overview, friends: [], outgoing: [] } }));
    expect(none).toContain('aria-label="Friend&#x27;s username"');
    expect(none).not.toContain("social-empty");

    const rooms = render(s, createElement(RoomsList, { overview, meId: DEMO_ME }));
    expect(rooms).toContain(">New room<");
    expect(rooms).toContain("Gym bros");
    expect(rooms).toContain("3 members · you&#x27;re 3rd"); // empty demo log: 0/0 behind Alex and Chris
  });

  it("offers a reset code from the sign-in form", () => {
    expect(render(services(seedDemoSocial(clock)), createElement(AccountCard))).toContain(">Forgot password?<");
  });
});
