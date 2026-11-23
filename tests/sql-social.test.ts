/**
 * Runs supabase/migrations 0001 and 0002 in a real Postgres (PGlite: Postgres compiled to WASM)
 * and calls the social functions as signed-in people, the way the app does through Supabase.
 *
 * Supabase is recreated just enough: the auth schema (users, and auth.uid() from the JWT's
 * `sub`), the anon and authenticated roles, and Supabase's default grants on everything new in
 * `public`. Every call runs in its own transaction as `authenticated` (or `anon`) with the claim
 * set, so privileges and row-level security apply as they do for the app.
 */
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const THIS_WEEK = "2026-11-23";
const LAST_WEEK = "2026-11-16";
const OLDER_WEEK = "2026-11-09";

const SUPABASE = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  -- Supabase grants the API roles everything new in public, so a migration must revoke what it keeps private.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

const migration = (file: string) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE);
  // Each twice: both files say they're safe to run again.
  for (const file of ["0001_init.sql", "0002_social.sql", "0001_init.sql", "0002_social.sql"]) {
    await db.exec(migration(file));
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// ───────────── Helpers ─────────────

type Role = "authenticated" | "anon";
type Row = Record<string, unknown>;

/** Runs `text` in its own transaction as `role`, signed in as `uid` (null: no JWT subject). */
async function run<T = Row>(role: Role, uid: string | null, text: string, params: unknown[] = [], setup = ""): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await tx.exec(`set local role ${role}; ${setup}`);
    return (await tx.query<T>(text, params)).rows;
  });
}

/** Calls public.<fn>(args…) as `role` and returns what it returned. */
async function call<T = unknown>(role: Role, uid: string | null, fn: string, args: unknown[], setup = ""): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}`).join(", ");
  const [row] = await run<{ v: T }>(role, uid, `select public.${fn}(${list}) as v`, args, setup);
  return row!.v;
}

/** Calls public.<fn>(args…) as the signed-in user `uid`, as the app's supabase.rpc does. */
const rpc = <T = unknown>(uid: string | null, fn: string, ...args: unknown[]) => call<T>("authenticated", uid, fn, args);

/** As the migration's owner (bypasses row-level security): for setting up and checking. */
async function sql<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(text, params)).rows;
}

interface Person {
  id: string;
  username: string;
}

/** A new account that hasn't picked a username yet. */
async function account(): Promise<string> {
  const id = randomUUID();
  await sql("insert into auth.users (id) values ($1)", [id]);
  return id;
}

let serial = 0;
/** A new account with a (unique) username. */
async function person(displayName = ""): Promise<Person> {
  const id = await account();
  const username = `user_${++serial}`;
  await rpc(id, "gt_claim_profile", username, displayName);
  return { id, username };
}

async function people(n: number): Promise<Person[]> {
  const list: Person[] = [];
  for (let i = 0; i < n; i++) list.push(await person());
  return list;
}

async function befriend(a: Person, b: Person) {
  expect(await rpc(a.id, "gt_request_friend", b.username)).toBe("sent");
  await rpc(b.id, "gt_answer_friend", a.id, true);
}

/** The pair's friendship rows (either direction). */
const pair = (a: Person, b: Person) =>
  sql(
    `select requester, addressee, status from public.friendships
     where (requester = $1 and addressee = $2) or (requester = $2 and addressee = $1)`,
    [a.id, b.id],
  );

const profileOf = (p: Person, displayName = "") => ({ id: p.id, username: p.username, displayName });

/** Saves one of `p`'s own records the way the app's sync does (as them, through row-level security). */
async function save(p: Person, table: "workout_days" | "sessions" | "splits", data: { id: string } & Row, deleted = false, updatedAt = "2026-11-21T10:00:00Z") {
  await run("authenticated", p.id, `insert into public.${table} (id, data, updated_at, deleted) values ($1, $2, $3, $4)`, [data.id, data, updatedAt, deleted]);
}

/** Publishes `p`'s score for a week, as the app does (an upsert of their own row). */
async function publish(p: Person, week: string, planned: number, done: number, streak: number) {
  await run(
    "authenticated",
    p.id,
    `insert into public.weekly_tallies (week_start, planned, done, streak) values ($1, $2, $3, $4)
     on conflict (user_id, week_start) do update set planned = excluded.planned, done = excluded.done, streak = excluded.streak`,
    [week, planned, done, streak],
  );
}

/** Room members as { user id: status }. */
async function members(room: string): Promise<Record<string, string>> {
  const rows = await sql<{ user_id: string; status: string }>("select user_id, status from public.room_members where room_id = $1", [room]);
  return Object.fromEntries(rows.map((r) => [r.user_id, r.status]));
}

async function ownerOf(room: string): Promise<string | undefined> {
  const [row] = await sql<{ owner: string }>("select owner from public.rooms where id = $1", [room]);
  return row?.owner;
}

/** PGlite's clock moves in milliseconds, so calls that must be ordered in time wait a little between. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

interface ProfileJson {
  id: string;
  username: string;
  displayName: string;
}
interface TallyJson {
  weekStart: string;
  planned: number;
  done: number;
}
interface MemberJson {
  profile: ProfileJson;
  status: string;
  thisWeek: TallyJson | null;
  lastWeek: TallyJson | null;
  streak: number;
}
interface Overview {
  me: ProfileJson | null;
  incoming: ProfileJson[];
  outgoing: ProfileJson[];
  friends: { profile: ProfileJson; thisWeek: TallyJson | null; streak: number }[];
  invites: { roomId: string; roomName: string; invitedBy: ProfileJson | null }[];
  rooms: { id: string; name: string; ownerId: string; members: MemberJson[] }[];
}
interface Records {
  days: Row[];
  split: Row | null;
  sessions: (Row & { id: string; logs: Row[] })[];
}

const overview = (uid: string) => rpc<Overview>(uid, "gt_social_overview", THIS_WEEK, LAST_WEEK);

const keys = (o: object) => Object.keys(o).sort();

/** Every function the app may call, with arguments that would do something. */
const someone = randomUUID();
const APP_CALLS: [string, unknown[]][] = [
  ["gt_claim_profile", ["somebody", ""]],
  ["gt_request_friend", ["somebody"]],
  ["gt_answer_friend", [someone, true]],
  ["gt_unfriend", [someone]],
  ["gt_friend_records", [someone, LAST_WEEK]],
  ["gt_create_room", ["Room", []]],
  ["gt_invite_to_room", [someone, []]],
  ["gt_answer_invite", [someone, true]],
  ["gt_leave_room", [someone]],
  ["gt_social_overview", [THIS_WEEK, LAST_WEEK]],
];
const HELPER_CALLS: [string, unknown[]][] = [
  ["gt_is_friend", [someone, someone]],
  ["gt_profile", [someone]],
  ["gt_tally", [someone, THIS_WEEK]],
  ["gt_streak", [someone, LAST_WEEK]],
];

// ───────────── Usernames ─────────────

describe("usernames", () => {
  it("gt_username_available says whether a name is free, ignoring case, signed in or not", async () => {
    const sam = await person();
    expect(await rpc(sam.id, "gt_username_available", sam.username)).toBe(false);
    expect(await call("anon", null, "gt_username_available", [sam.username.toUpperCase()])).toBe(false);
    expect(await call("anon", null, "gt_username_available", ["nobody_has_this"])).toBe(true);
  });

  it("gt_claim_profile picks a username (lowercased) and display name, and can change both", async () => {
    const id = await account();
    expect(await rpc(id, "gt_claim_profile", "Sam_Lifts", "Sam")).toEqual({ id, username: "sam_lifts", displayName: "Sam" });
    // Your own name again isn't "taken"; a null display name is stored as none.
    expect(await rpc(id, "gt_claim_profile", "sam_lifts", null)).toEqual({ id, username: "sam_lifts", displayName: "" });
    expect(await rpc(id, "gt_claim_profile", "sam_2", "Sammy")).toEqual({ id, username: "sam_2", displayName: "Sammy" });
    // The old name is free again.
    expect(await call("anon", null, "gt_username_available", ["sam_lifts"])).toBe(true);
  });

  it("a taken username raises username_taken and changes nothing", async () => {
    const taken = await person();
    const me = await person("Me");
    await expect(rpc(me.id, "gt_claim_profile", taken.username.toUpperCase(), "New")).rejects.toThrow("username_taken");
    const fresh = await account();
    await expect(rpc(fresh, "gt_claim_profile", taken.username, "")).rejects.toThrow("username_taken");
    expect(await sql("select username, display_name from public.profiles where id = $1", [me.id])).toEqual([{ username: me.username, display_name: "Me" }]);
    expect(await sql("select id from public.profiles where id = $1", [fresh])).toEqual([]);
  });

  it.each(["ab", "a".repeat(21), "has space", "dash-name", "émile", "", "semi;colon"])("the format check rejects %j", async (bad) => {
    const id = await account();
    await expect(rpc(id, "gt_claim_profile", bad, "")).rejects.toThrow("profiles_username_format");
  });

  it("display names are at most 40 characters", async () => {
    const id = await account();
    await expect(rpc(id, "gt_claim_profile", `ok_${serial++}`, "x".repeat(41))).rejects.toThrow("profiles_display_name_length");
  });
});

// ───────────── Friends ─────────────

describe("friend requests", () => {
  it("gt_request_friend returns sent, already_requested, accepted, already_friends, not_found and self", async () => {
    const [me, them] = await people(2);
    expect(await rpc(me!.id, "gt_request_friend", them!.username)).toBe("sent");
    expect(await pair(me!, them!)).toEqual([{ requester: me!.id, addressee: them!.id, status: "pending" }]);
    expect(await rpc(me!.id, "gt_request_friend", them!.username.toUpperCase())).toBe("already_requested");
    // They had already been asked, so asking back makes you friends.
    expect(await rpc(them!.id, "gt_request_friend", me!.username)).toBe("accepted");
    expect(await pair(me!, them!)).toEqual([{ requester: me!.id, addressee: them!.id, status: "accepted" }]);
    expect(await rpc(me!.id, "gt_request_friend", them!.username)).toBe("already_friends");
    expect(await rpc(them!.id, "gt_request_friend", me!.username)).toBe("already_friends");
    expect(await rpc(me!.id, "gt_request_friend", "nobody_by_this")).toBe("not_found");
    expect(await rpc(me!.id, "gt_request_friend", me!.username)).toBe("self");
  });

  it("needs a username first (no_username)", async () => {
    const [them] = await people(1);
    const nameless = await account();
    await expect(rpc(nameless, "gt_request_friend", them!.username)).rejects.toThrow("no_username");
  });

  it("gt_answer_friend accepts or declines a request sent to you", async () => {
    const [me, a, b] = await people(3);
    await rpc(a!.id, "gt_request_friend", me!.username);
    await rpc(b!.id, "gt_request_friend", me!.username);
    await rpc(me!.id, "gt_answer_friend", a!.id, true);
    await rpc(me!.id, "gt_answer_friend", b!.id, false);
    expect(await pair(me!, a!)).toEqual([{ requester: a!.id, addressee: me!.id, status: "accepted" }]);
    expect(await pair(me!, b!)).toEqual([]);
    // Declined, they can ask again.
    expect(await rpc(b!.id, "gt_request_friend", me!.username)).toBe("sent");
  });

  it("whoever asked can't answer their own request", async () => {
    const [me, asker] = await people(2);
    await rpc(asker!.id, "gt_request_friend", me!.username);
    await rpc(asker!.id, "gt_answer_friend", me!.id, true);
    await rpc(asker!.id, "gt_answer_friend", me!.id, false);
    expect(await pair(me!, asker!)).toEqual([{ requester: asker!.id, addressee: me!.id, status: "pending" }]);
  });

  it("gt_unfriend works from either side, and takes back or turns down a pending request", async () => {
    const [me, a, b, c, d] = await people(5);
    await befriend(me!, a!);
    await befriend(b!, me!);
    await rpc(me!.id, "gt_unfriend", a!.id); // I asked
    await rpc(me!.id, "gt_unfriend", b!.id); // they asked
    await rpc(me!.id, "gt_request_friend", c!.username);
    await rpc(me!.id, "gt_unfriend", c!.id); // taking my request back
    await rpc(d!.id, "gt_request_friend", me!.username);
    await rpc(me!.id, "gt_unfriend", d!.id); // turning theirs down
    for (const other of [a!, b!, c!, d!]) expect(await pair(me!, other)).toEqual([]);
  });
});

// ───────────── A friend's records ─────────────

describe("gt_friend_records", () => {
  it("raises not_friends unless you're friends (a pending request isn't enough)", async () => {
    const [me, stranger, asked] = await people(3);
    await expect(rpc(me!.id, "gt_friend_records", stranger!.id, LAST_WEEK)).rejects.toThrow("not_friends");
    await rpc(me!.id, "gt_request_friend", asked!.username);
    await expect(rpc(me!.id, "gt_friend_records", asked!.id, LAST_WEEK)).rejects.toThrow("not_friends");
    await expect(rpc(asked!.id, "gt_friend_records", me!.id, LAST_WEEK)).rejects.toThrow("not_friends");
    await expect(rpc(me!.id, "gt_friend_records", me!.id, LAST_WEEK)).rejects.toThrow("not_friends");
    // Friends once, then not: closed again.
    await rpc(asked!.id, "gt_answer_friend", me!.id, true);
    await rpc(asked!.id, "gt_friend_records", me!.id, LAST_WEEK);
    await rpc(asked!.id, "gt_unfriend", me!.id);
    await expect(rpc(asked!.id, "gt_friend_records", me!.id, LAST_WEEK)).rejects.toThrow("not_friends");
  });

  const log = (exerciseId: string, note?: string) => ({
    exerciseId,
    sets: [{ weight: 100, reps: 5 }],
    done: null,
    ...(note === undefined ? {} : { note }),
    unit: "kg",
  });
  const session = (date: string, logs: Row[]) => ({ id: `upper:${date}`, date, workoutDayId: "upper", logs, updatedAt: `${date}T10:00:00Z`, deleted: false });

  async function friendWithRecords() {
    const [me, friend, stranger] = await people(3);
    await befriend(me!, friend!);
    await save(friend!, "workout_days", { id: "upper", name: "Upper", order: 0, exercises: [] });
    await save(friend!, "workout_days", { id: "gone", name: "Gone", order: 1, exercises: [] }, true);
    await save(friend!, "splits", { id: "default", name: "Friend split", pattern: ["upper", null, null, null, null, null, null] }, false, "2026-11-01T00:00:00Z");
    await save(friend!, "splits", { id: "draft", name: "Deleted split", pattern: [] }, true, "2026-11-20T00:00:00Z");
    await save(friend!, "sessions", session(LAST_WEEK, [log("bench", "felt weak"), log("row")])); // on `since`
    await save(friend!, "sessions", session("2026-11-20", [log("bench", "secret")]));
    await save(friend!, "sessions", session("2026-11-12", [log("bench")])); // before `since`
    await save(friend!, "sessions", session("2026-11-18", [log("bench")]), true); // deleted
    // Other people's rows, which must never show up.
    for (const other of [me!, stranger!]) {
      await save(other, "workout_days", { id: "upper", name: `${other.username} day`, order: 0, exercises: [] });
      await save(other, "splits", { id: "default", name: `${other.username} split`, pattern: [] }, false, "2026-11-22T00:00:00Z");
      await save(other, "sessions", { ...session("2026-11-21", [log("squat", `${other.username} note`)]), id: "legs:2026-11-21" });
    }
    return { me: me!, friend: friend!, stranger: stranger! };
  }

  it("returns their days, split and sessions on or after `since`, without deleted rows or anyone else's", async () => {
    const { me, friend, stranger } = await friendWithRecords();
    const records = await rpc<Records>(me.id, "gt_friend_records", friend.id, LAST_WEEK);
    expect(keys(records)).toEqual(["days", "sessions", "split"]);
    expect(records.days).toEqual([{ id: "upper", name: "Upper", order: 0, exercises: [] }]);
    expect(records.split).toEqual({ id: "default", name: "Friend split", pattern: ["upper", null, null, null, null, null, null] });
    expect(records.sessions.map((s) => s.id).sort()).toEqual([`upper:${LAST_WEEK}`, "upper:2026-11-20"]);
    const text = JSON.stringify(records);
    expect(text).not.toContain(me.username);
    expect(text).not.toContain(stranger.username);
  });

  it("blanks every log's note and keeps the rest of the log", async () => {
    const { me, friend } = await friendWithRecords();
    const records = await rpc<Records>(me.id, "gt_friend_records", friend.id, LAST_WEEK);
    for (const s of records.sessions) for (const l of s.logs) expect(l.note).toBe("");
    expect(JSON.stringify(records)).not.toMatch(/felt weak|secret|note"\s*:\s*"[^"]/);
    const first = records.sessions.find((s) => s.id === `upper:${LAST_WEEK}`)!;
    expect(first).toEqual({ ...session(LAST_WEEK, []), logs: [{ ...log("bench"), note: "" }, { ...log("row"), note: "" }] });
  });

  it("works for the friend who was asked, too (friendship goes both ways)", async () => {
    const { me, friend } = await friendWithRecords();
    const mine = await rpc<Records>(friend.id, "gt_friend_records", me.id, OLDER_WEEK);
    expect(mine.days).toEqual([{ id: "upper", name: `${me.username} day`, order: 0, exercises: [] }]);
    expect(mine.sessions.map((s) => s.id)).toEqual(["legs:2026-11-21"]);
    expect(mine.sessions[0]!.logs[0]!.note).toBe("");
  });

  it("a friend with nothing saved yet has empty lists and no split", async () => {
    const [me, friend] = await people(2);
    await befriend(me!, friend!);
    expect(await rpc(me!.id, "gt_friend_records", friend!.id, LAST_WEEK)).toEqual({ days: [], split: null, sessions: [] });
  });

  it("picks sessions by date the same whatever the connection's DateStyle", async () => {
    const { me, friend } = await friendWithRecords();
    const records = await call<Records>("authenticated", me.id, "gt_friend_records", [friend.id, LAST_WEEK], "set local datestyle = 'SQL, DMY';");
    expect(records.sessions.map((s) => s.id).sort()).toEqual([`upper:${LAST_WEEK}`, "upper:2026-11-20"]);
  });
});

// ───────────── Rooms ─────────────

describe("rooms", () => {
  it("gt_create_room puts you in as owner and invites only your friends", async () => {
    const [me, f1, f2, notFriend, asked] = await people(5);
    await befriend(me!, f1!);
    await befriend(f2!, me!);
    await rpc(me!.id, "gt_request_friend", asked!.username); // pending isn't friends
    const room = await rpc<string>(me!.id, "gt_create_room", "  Early birds  ", [f1!.id, notFriend!.id, me!.id, f1!.id, asked!.id, f2!.id]);
    expect(room).toMatch(/^[0-9a-f-]{36}$/);
    expect(await sql("select name, owner from public.rooms where id = $1", [room])).toEqual([{ name: "Early birds", owner: me!.id }]);
    expect(await members(room)).toEqual({ [me!.id]: "joined", [f1!.id]: "invited", [f2!.id]: "invited" });
    expect(await sql("select distinct invited_by from public.room_members where room_id = $1", [room])).toEqual([{ invited_by: me!.id }]);
  });

  it("gt_create_room needs a username and a name, and works without invitees", async () => {
    const nameless = await account();
    await expect(rpc(nameless, "gt_create_room", "Room", [])).rejects.toThrow("no_username");
    const [me] = await people(1);
    await expect(rpc(me!.id, "gt_create_room", "   ", [])).rejects.toThrow("rooms_name_length");
    const room = await rpc<string>(me!.id, "gt_create_room", "Solo", null);
    expect(await members(room)).toEqual({ [me!.id]: "joined" });
  });

  it("gt_invite_to_room raises not_member unless you've joined, and invites only your friends", async () => {
    const [owner, guest, guestsFriend, outsider] = await people(4);
    await befriend(owner!, guest!);
    await befriend(guest!, guestsFriend!);
    await befriend(outsider!, owner!);
    const room = await rpc<string>(owner!.id, "gt_create_room", "Room", [guest!.id]);
    await expect(rpc(outsider!.id, "gt_invite_to_room", room, [owner!.id])).rejects.toThrow("not_member");
    // Invited isn't joined.
    await expect(rpc(guest!.id, "gt_invite_to_room", room, [guestsFriend!.id])).rejects.toThrow("not_member");
    await rpc(guest!.id, "gt_answer_invite", room, true);
    // outsider isn't guest's friend; owner is already in.
    await rpc(guest!.id, "gt_invite_to_room", room, [guestsFriend!.id, outsider!.id, owner!.id]);
    expect(await members(room)).toEqual({ [owner!.id]: "joined", [guest!.id]: "joined", [guestsFriend!.id]: "invited" });
    expect(await sql("select invited_by from public.room_members where room_id = $1 and user_id = $2", [room, guestsFriend!.id])).toEqual([{ invited_by: guest!.id }]);
  });

  it("gt_answer_invite joins or declines, and can't get you into a room you weren't invited to", async () => {
    const [owner, yes, no, gatecrasher] = await people(4);
    await befriend(owner!, yes!);
    await befriend(owner!, no!);
    const room = await rpc<string>(owner!.id, "gt_create_room", "Room", [yes!.id, no!.id]);
    await rpc(yes!.id, "gt_answer_invite", room, true);
    await rpc(no!.id, "gt_answer_invite", room, false);
    await rpc(gatecrasher!.id, "gt_answer_invite", room, true);
    expect(await members(room)).toEqual({ [owner!.id]: "joined", [yes!.id]: "joined" });
    expect((await overview(no!.id)).invites).toEqual([]);
  });

  it("gt_leave_room hands the room to whoever joined longest ago, never to someone only invited", async () => {
    const [owner, invitedFirst, joinedFirst, pending] = await people(4);
    for (const p of [invitedFirst!, joinedFirst!, pending!]) await befriend(owner!, p);
    const room = await rpc<string>(owner!.id, "gt_create_room", "Room", [invitedFirst!.id, pending!.id]);
    await tick();
    await rpc(owner!.id, "gt_invite_to_room", room, [joinedFirst!.id]);
    await tick();
    await rpc(joinedFirst!.id, "gt_answer_invite", room, true);
    await tick();
    await rpc(invitedFirst!.id, "gt_answer_invite", room, true);
    await rpc(owner!.id, "gt_leave_room", room);
    expect(await ownerOf(room)).toBe(joinedFirst!.id);
    // A member who isn't the owner leaving changes nothing else.
    await rpc(invitedFirst!.id, "gt_leave_room", room);
    expect(await ownerOf(room)).toBe(joinedFirst!.id);
    expect(await members(room)).toEqual({ [joinedFirst!.id]: "joined", [pending!.id]: "invited" });
  });

  it("the last member out deletes the room, pending invites with it", async () => {
    const [owner, guest, invitee] = await people(3);
    await befriend(owner!, guest!);
    await befriend(owner!, invitee!);
    const room = await rpc<string>(owner!.id, "gt_create_room", "Room", [guest!.id, invitee!.id]);
    await rpc(guest!.id, "gt_answer_invite", room, true);
    await rpc(owner!.id, "gt_leave_room", room);
    expect(await ownerOf(room)).toBe(guest!.id);
    await rpc(guest!.id, "gt_leave_room", room);
    expect(await ownerOf(room)).toBeUndefined();
    expect(await members(room)).toEqual({});
    expect((await overview(invitee!.id)).invites).toEqual([]);
  });

  it("an invite outlives the account that sent it (invitedBy becomes null)", async () => {
    const [owner, guest, guestsFriend] = await people(3);
    await befriend(owner!, guest!);
    await befriend(guest!, guestsFriend!);
    const room = await rpc<string>(owner!.id, "gt_create_room", "Room", [guest!.id]);
    await rpc(guest!.id, "gt_answer_invite", room, true);
    await rpc(guest!.id, "gt_invite_to_room", room, [guestsFriend!.id]);
    await sql("delete from auth.users where id = $1", [guest!.id]);
    expect((await overview(guestsFriend!.id)).invites).toEqual([{ roomId: room, roomName: "Room", invitedBy: null }]);
    expect(await members(room)).toEqual({ [owner!.id]: "joined", [guestsFriend!.id]: "invited" });
    expect((await overview(owner!.id)).friends).toEqual([]);
  });

  it("leaving a room you're not in changes nothing", async () => {
    const [owner, stranger] = await people(2);
    const room = await rpc<string>(owner!.id, "gt_create_room", "Room", []);
    await rpc(stranger!.id, "gt_leave_room", room);
    expect(await ownerOf(room)).toBe(owner!.id);
    expect(await members(room)).toEqual({ [owner!.id]: "joined" });
  });
});

// ───────────── The Social page ─────────────

describe("gt_social_overview", () => {
  it("is empty until you pick a username", async () => {
    const nameless = await account();
    expect(await overview(nameless)).toEqual({ me: null, incoming: [], outgoing: [], friends: [], invites: [], rooms: [] });
  });

  it("has the shape the Social page reads", async () => {
    const me = await person("Alex A");
    const [buddy, quiet, asker, asked, inviter, roomie, invitee] = await people(7);
    await befriend(me, buddy!);
    await befriend(quiet!, me);
    await rpc(asker!.id, "gt_request_friend", me.username);
    await rpc(me.id, "gt_request_friend", asked!.username);
    await befriend(inviter!, me);
    await befriend(me, roomie!);
    await befriend(me, invitee!);
    await publish(buddy!, LAST_WEEK, 4, 4, 4);
    await publish(buddy!, THIS_WEEK, 4, 3, 5);
    await publish(roomie!, LAST_WEEK, 3, 2, 0);
    await publish(invitee!, THIS_WEEK, 2, 2, 7);
    const room = await rpc<string>(me.id, "gt_create_room", "Lifters", [roomie!.id, invitee!.id]);
    await rpc(roomie!.id, "gt_answer_invite", room, true);
    const elsewhere = await rpc<string>(inviter!.id, "gt_create_room", "Their room", [me.id]);

    const o = await overview(me.id);
    expect(keys(o)).toEqual(["friends", "incoming", "invites", "me", "outgoing", "rooms"]);
    expect(o.me).toEqual(profileOf(me, "Alex A"));
    expect(o.incoming).toEqual([profileOf(asker!)]);
    expect(o.outgoing).toEqual([profileOf(asked!)]);

    expect(o.friends).toHaveLength(5);
    for (const f of o.friends) expect(keys(f)).toEqual(["profile", "streak", "thisWeek"]);
    const friend = (p: Person) => o.friends.find((f) => f.profile.id === p.id);
    expect(friend(buddy!)).toEqual({ profile: profileOf(buddy!), thisWeek: { weekStart: THIS_WEEK, planned: 4, done: 3 }, streak: 5 });
    expect(friend(quiet!)).toEqual({ profile: profileOf(quiet!), thisWeek: null, streak: 0 });

    expect(o.invites).toEqual([{ roomId: elsewhere, roomName: "Their room", invitedBy: profileOf(inviter!) }]);

    // Only rooms you've joined (the invite above isn't one).
    expect(o.rooms).toHaveLength(1);
    const [r] = o.rooms;
    expect(keys(r!)).toEqual(["id", "members", "name", "ownerId"]);
    expect(r).toMatchObject({ id: room, name: "Lifters", ownerId: me.id });
    for (const m of r!.members) expect(keys(m)).toEqual(["lastWeek", "profile", "status", "streak", "thisWeek"]);
    const member = (p: Person) => r!.members.find((m) => m.profile.id === p.id);
    expect(member(me)).toEqual({ profile: profileOf(me, "Alex A"), status: "joined", thisWeek: null, lastWeek: null, streak: 0 });
    expect(member(roomie!)).toEqual({ profile: profileOf(roomie!), status: "joined", thisWeek: null, lastWeek: { weekStart: LAST_WEEK, planned: 3, done: 2 }, streak: 0 });
    // Someone only invited hasn't agreed to show the room their scores yet.
    expect(member(invitee!)).toEqual({ profile: profileOf(invitee!), status: "invited", thisWeek: null, lastWeek: null, streak: 0 });
  });

  it("shows a member's scores once they join", async () => {
    const [me, invitee] = await people(2);
    await befriend(me!, invitee!);
    await publish(invitee!, THIS_WEEK, 2, 1, 3);
    const room = await rpc<string>(me!.id, "gt_create_room", "Room", [invitee!.id]);
    await rpc(invitee!.id, "gt_answer_invite", room, true);
    const [r] = (await overview(me!.id)).rooms;
    expect(r!.members.find((m) => m.profile.id === invitee!.id)).toMatchObject({ status: "joined", thisWeek: { weekStart: THIS_WEEK, planned: 2, done: 1 }, streak: 3 });
  });

  it("takes the streak from the newest tally no older than last week", async () => {
    const [me, current, lastOnly, lapsed] = await people(4);
    for (const p of [current!, lastOnly!, lapsed!]) await befriend(me!, p);
    await publish(current!, LAST_WEEK, 3, 3, 4);
    await publish(current!, THIS_WEEK, 3, 1, 5);
    await publish(lastOnly!, LAST_WEEK, 3, 3, 3);
    await publish(lapsed!, OLDER_WEEK, 3, 3, 9);
    const { friends } = await overview(me!.id);
    const streak = (p: Person) => friends.find((f) => f.profile.id === p.id)?.streak;
    expect([streak(current!), streak(lastOnly!), streak(lapsed!)]).toEqual([5, 3, 0]);
  });
});

// ───────────── Security ─────────────

describe("what a signed-in user can reach directly", () => {
  it("calls here really run as that user, not as the owner", async () => {
    const [me] = await people(1);
    expect(await run("authenticated", me!.id, "select current_user as role, auth.uid() as uid")).toEqual([{ role: "authenticated", uid: me!.id }]);
    expect(await run("anon", null, "select current_user as role, auth.uid() as uid")).toEqual([{ role: "anon", uid: null }]);
    expect(await sql("select rolsuper, rolbypassrls from pg_roles where rolname in ('anon', 'authenticated')")).toEqual([
      { rolsuper: false, rolbypassrls: false },
      { rolsuper: false, rolbypassrls: false },
    ]);
  });

  it.each(["profiles", "friendships", "rooms", "room_members"])("%s: no select, insert, update or delete", async (table) => {
    const [me] = await people(1);
    for (const statement of [
      `select * from public.${table}`,
      `insert into public.${table} default values`,
      `update public.${table} set created_at = now()`,
      `delete from public.${table}`,
    ]) {
      await expect(run("authenticated", me!.id, statement)).rejects.toThrow(`permission denied for table ${table}`);
      await expect(run("anon", null, statement)).rejects.toThrow(`permission denied for table ${table}`);
    }
  });

  it("weekly_tallies: only your own rows, to read or write", async () => {
    const [me, other] = await people(2);
    await publish(other!, THIS_WEEK, 4, 2, 1);
    await publish(me!, THIS_WEEK, 3, 1, 0);
    await publish(me!, THIS_WEEK, 3, 2, 0); // the app's upsert
    expect(await run("authenticated", me!.id, "select user_id, week_start::text, planned, done from public.weekly_tallies")).toEqual([
      { user_id: me!.id, week_start: THIS_WEEK, planned: 3, done: 2 },
    ]);
    await expect(
      run("authenticated", me!.id, "insert into public.weekly_tallies (user_id, week_start, planned, done) values ($1, $2, 7, 7)", [other!.id, LAST_WEEK]),
    ).rejects.toThrow("row-level security");
    expect(await run("authenticated", me!.id, "update public.weekly_tallies set done = 7 where user_id = $1 returning *", [other!.id])).toEqual([]);
    await expect(run("authenticated", me!.id, "update public.weekly_tallies set user_id = $1", [other!.id])).rejects.toThrow("row-level security");
    await expect(run("authenticated", me!.id, "delete from public.weekly_tallies")).rejects.toThrow("permission denied");
    expect(await sql("select done from public.weekly_tallies where user_id = $1", [other!.id])).toEqual([{ done: 2 }]);
    await expect(run("anon", null, "select * from public.weekly_tallies")).rejects.toThrow("permission denied");
  });

  it.each(["workout_days", "sessions", "splits"] as const)("%s (0001) still shows and changes only your own rows", async (table) => {
    const [me, other] = await people(2);
    await save(other!, table, { id: "x", owner: "other" });
    await save(me!, table, { id: "x", owner: "me" });
    expect(await run("authenticated", me!.id, `select user_id, data from public.${table}`)).toEqual([{ user_id: me!.id, data: { id: "x", owner: "me" } }]);
    await expect(
      run("authenticated", me!.id, `insert into public.${table} (user_id, id, data, updated_at) values ($1, 'y', '{}', now())`, [other!.id]),
    ).rejects.toThrow("row-level security");
    expect(await run("authenticated", me!.id, `update public.${table} set data = '{}' where user_id = $1 returning *`, [other!.id])).toEqual([]);
    expect(await run("authenticated", me!.id, `delete from public.${table} where user_id = $1 returning *`, [other!.id])).toEqual([]);
    expect(await sql(`select data from public.${table} where user_id = $1`, [other!.id])).toEqual([{ data: { id: "x", owner: "other" } }]);
    expect(await run("anon", null, `select * from public.${table}`)).toEqual([]);
  });
});

describe("who may call which function", () => {
  const callable = async (role: Role) =>
    (
      await sql<{ proname: string }>(
        `select p.proname from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
           and has_function_privilege('${role}', p.oid, 'execute')
         order by 1`,
      )
    ).map((r) => r.proname);

  it("authenticated may run the app's functions and anon only gt_username_available", async () => {
    expect(await callable("authenticated")).toEqual([...APP_CALLS.map(([fn]) => fn), "gt_username_available"].sort());
    expect(await callable("anon")).toEqual(["gt_username_available"]);
  });

  it.each(HELPER_CALLS)("%s can't be called by authenticated or anon", async (fn, args) => {
    const [me] = await people(1);
    await expect(call("authenticated", me!.id, fn, args)).rejects.toThrow(`permission denied for function ${fn}`);
    await expect(call("anon", null, fn, args)).rejects.toThrow(`permission denied for function ${fn}`);
  });

  it.each(APP_CALLS)("anon can't call %s", async (fn, args) => {
    await expect(call("anon", null, fn, args)).rejects.toThrow(`permission denied for function ${fn}`);
  });

  it.each(APP_CALLS)("%s needs a signed-in user (signed_out)", async (fn, args) => {
    await expect(call("authenticated", null, fn, args)).rejects.toThrow("signed_out");
  });

  it("every security definer function has an empty search_path", async () => {
    const rows = await sql<{ proname: string; proconfig: string[] | null }>(
      "select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prosecdef order by 1",
    );
    expect(rows.map((r) => r.proname)).toEqual([...APP_CALLS, ...HELPER_CALLS].map(([fn]) => fn).concat("gt_username_available").sort());
    for (const r of rows) expect(r.proconfig, r.proname).toEqual(['search_path=""']);
  });
});

describe("running the migrations again", () => {
  it("keeps everyone's data and the same access", async () => {
    const me = await person("Still here");
    const [friend] = await people(1);
    await befriend(me, friend!);
    await db.exec(migration("0001_init.sql"));
    await db.exec(migration("0002_social.sql"));
    const o = await overview(me.id);
    expect(o.me).toEqual(profileOf(me, "Still here"));
    expect(o.friends.map((f) => f.profile)).toEqual([profileOf(friend!)]);
    await expect(run("authenticated", me.id, "select * from public.profiles")).rejects.toThrow("permission denied");
    await expect(call("authenticated", me.id, "gt_profile", [me.id])).rejects.toThrow("permission denied");
  });
});
