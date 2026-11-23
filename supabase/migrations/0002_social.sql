-- Gym Tracker social: usernames, friends, rooms, weekly scores (TASKS.md D53).
-- Paste into Supabase → SQL Editor → Run, after 0001_init.sql (safe to run again).
--
-- Nothing here opens up the existing tables: a friend's workouts are read only through
-- gt_friend_records, which checks you're friends and removes notes. The app's own sync reads
-- the tables directly, so they stay "own rows only". Every function below that crosses
-- accounts is `security definer` (it runs as the owner and checks auth.uid() itself) with an
-- empty search_path, so names are always schema-qualified.

-- ───────────── Tables ─────────────

-- How people find and see each other. Never their email.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length check (char_length(display_name) <= 40)
);
create unique index if not exists profiles_username_key on public.profiles (username);

-- One row per pair: a pending request from requester to addressee, or friends once accepted.
create table if not exists public.friendships (
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  constraint friendships_not_self check (requester <> addressee),
  constraint friendships_status check (status in ('pending', 'accepted'))
);
-- A pair can't have rows both ways (A→B and B→A).
create unique index if not exists friendships_pair_key
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint rooms_name_length check (char_length(name) between 1 and 40)
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- When they joined: the next owner is whoever joined longest ago, not whoever was invited first.
  joined_at timestamptz,
  primary key (room_id, user_id),
  constraint room_members_status check (status in ('invited', 'joined'))
);
create index if not exists room_members_user_idx on public.room_members (user_id);

-- Each person's own weekly score, published by their app: workouts planned and done that
-- week (Monday start) and their streak of weeks with every planned workout done.
create table if not exists public.weekly_tallies (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start date not null,
  planned smallint not null,
  done smallint not null,
  streak integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start),
  constraint weekly_tallies_planned check (planned between 0 and 7),
  constraint weekly_tallies_done check (done between 0 and 7),
  constraint weekly_tallies_streak check (streak >= 0),
  constraint weekly_tallies_monday check (extract(isodow from week_start) = 1)
);

-- ───────────── Access ─────────────
-- Row-level security on, with no policies except your own tallies: everything else goes
-- through the functions below.

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.weekly_tallies enable row level security;

revoke all on public.profiles, public.friendships, public.rooms, public.room_members, public.weekly_tallies from anon, authenticated;
grant select, insert, update on public.weekly_tallies to authenticated;

drop policy if exists "own rows" on public.weekly_tallies;
create policy "own rows" on public.weekly_tallies for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ───────────── Helpers ─────────────

create or replace function public.gt_is_friend(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))
  );
$$;

-- {"id","username","displayName"} or null.
create or replace function public.gt_profile(uid uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'displayName', p.display_name)
  from public.profiles p where p.id = uid;
$$;

-- {"weekStart","planned","done"} or null.
create or replace function public.gt_tally(uid uuid, week date)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('weekStart', t.week_start, 'planned', t.planned, 'done', t.done)
  from public.weekly_tallies t where t.user_id = uid and t.week_start = week;
$$;

-- The streak from their newest tally no older than last week (an older one has lapsed).
create or replace function public.gt_streak(uid uuid, last_week date)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select t.streak from public.weekly_tallies t
    where t.user_id = uid and t.week_start >= last_week
    order by t.week_start desc limit 1
  ), 0);
$$;

-- ───────────── Usernames ─────────────

create or replace function public.gt_username_available(name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.profiles p where p.username = lower(name));
$$;

-- Picks or changes your username and display name. Raises 'username_taken'.
create or replace function public.gt_claim_profile(name text, display text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'signed_out'; end if;
  begin
    insert into public.profiles (id, username, display_name)
    values (me, lower(name), coalesce(display, ''))
    on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
  exception when unique_violation then
    raise exception 'username_taken';
  end;
  return public.gt_profile(me);
end;
$$;

-- ───────────── Friends ─────────────

-- 'sent' | 'accepted' (they had asked you) | 'not_found' | 'self' | 'already_friends' | 'already_requested'
create or replace function public.gt_request_friend(name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  them uuid;
  existing public.friendships;
begin
  if me is null then raise exception 'signed_out'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'no_username'; end if;
  select id into them from public.profiles where username = lower(name);
  if them is null then return 'not_found'; end if;
  if them = me then return 'self'; end if;
  select * into existing from public.friendships
    where (requester = me and addressee = them) or (requester = them and addressee = me);
  if found then
    if existing.status = 'accepted' then return 'already_friends'; end if;
    if existing.requester = me then return 'already_requested'; end if;
    update public.friendships set status = 'accepted' where requester = them and addressee = me;
    return 'accepted';
  end if;
  insert into public.friendships (requester, addressee) values (me, them);
  return 'sent';
end;
$$;

create or replace function public.gt_answer_friend(other uuid, accept boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'signed_out'; end if;
  if accept then
    update public.friendships set status = 'accepted'
      where requester = other and addressee = me and status = 'pending';
  else
    delete from public.friendships where requester = other and addressee = me and status = 'pending';
  end if;
end;
$$;

-- Removes a friend, or takes back / turns down a request, either way.
create or replace function public.gt_unfriend(other uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'signed_out'; end if;
  delete from public.friendships
    where (requester = me and addressee = other) or (requester = other and addressee = me);
end;
$$;

-- A friend's workout days, split and sessions since `since`, with every note removed.
create or replace function public.gt_friend_records(friend uuid, since date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'signed_out'; end if;
  if not public.gt_is_friend(me, friend) then raise exception 'not_friends'; end if;
  return jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(d.data) from public.workout_days d
      where d.user_id = friend and not d.deleted), '[]'::jsonb),
    'split', (
      select s.data from public.splits s
      where s.user_id = friend and not s.deleted
      order by s.updated_at desc limit 1),
    'sessions', coalesce((
      select jsonb_agg(
        jsonb_set(x.data, '{logs}', coalesce((
          select jsonb_agg((l - 'note') || jsonb_build_object('note', ''))
          from jsonb_array_elements(coalesce(x.data -> 'logs', '[]'::jsonb)) l), '[]'::jsonb)))
      from public.sessions x
      -- to_char, not since::text: a date's text form follows the connection's DateStyle.
      where x.user_id = friend and not x.deleted and (x.data ->> 'date') >= to_char(since, 'YYYY-MM-DD')), '[]'::jsonb)
  );
end;
$$;

-- ───────────── Rooms ─────────────

-- Creates a room with you in it and invites friends (anyone else in the list is skipped).
create or replace function public.gt_create_room(room_name text, invitees uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  room uuid;
begin
  if me is null then raise exception 'signed_out'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'no_username'; end if;
  insert into public.rooms (name, owner) values (btrim(room_name), me) returning id into room;
  insert into public.room_members (room_id, user_id, status, invited_by, joined_at) values (room, me, 'joined', me, now());
  insert into public.room_members (room_id, user_id, status, invited_by)
    select distinct room, i, 'invited', me from unnest(coalesce(invitees, '{}')) i
    where i <> me and public.gt_is_friend(me, i)
    on conflict do nothing;
  return room;
end;
$$;

-- Invites more of your friends to a room you've joined.
create or replace function public.gt_invite_to_room(room uuid, invitees uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'signed_out'; end if;
  if not exists (select 1 from public.room_members where room_id = room and user_id = me and status = 'joined') then
    raise exception 'not_member';
  end if;
  insert into public.room_members (room_id, user_id, status, invited_by)
    select distinct room, i, 'invited', me from unnest(coalesce(invitees, '{}')) i
    where i <> me and public.gt_is_friend(me, i)
    on conflict do nothing;
end;
$$;

create or replace function public.gt_answer_invite(room uuid, accept boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'signed_out'; end if;
  if accept then
    update public.room_members set status = 'joined', joined_at = now()
      where room_id = room and user_id = me and status = 'invited';
  else
    delete from public.room_members where room_id = room and user_id = me and status = 'invited';
  end if;
end;
$$;

-- Leaves a room. The last one out deletes it; an owner who leaves hands it to whoever joined longest ago.
create or replace function public.gt_leave_room(room uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  heir uuid;
begin
  if me is null then raise exception 'signed_out'; end if;
  -- One leaver at a time: the last two leaving together would each pick the other and strand the room empty.
  perform 1 from public.rooms where id = room for update;
  delete from public.room_members where room_id = room and user_id = me;
  select user_id into heir from public.room_members
    where room_id = room and status = 'joined' order by joined_at, user_id limit 1;
  if heir is null then
    delete from public.rooms where id = room;
  else
    update public.rooms set owner = heir where id = room and owner = me;
  end if;
end;
$$;

-- ───────────── The Social page ─────────────

-- Everything the Social page shows: your profile, requests both ways, friends with this week's
-- score and streak, room invites, and your rooms with every member's scores for both weeks.
create or replace function public.gt_social_overview(this_week date, last_week date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'signed_out'; end if;
  return jsonb_build_object(
    'me', public.gt_profile(me),
    'incoming', coalesce((
      select jsonb_agg(public.gt_profile(f.requester) order by f.created_at)
      from public.friendships f
      where f.addressee = me and f.status = 'pending' and public.gt_profile(f.requester) is not null), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(public.gt_profile(f.addressee) order by f.created_at)
      from public.friendships f
      where f.requester = me and f.status = 'pending' and public.gt_profile(f.addressee) is not null), '[]'::jsonb),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile', public.gt_profile(o.id),
        'thisWeek', public.gt_tally(o.id, this_week),
        'streak', public.gt_streak(o.id, last_week)))
      from (
        select case when f.requester = me then f.addressee else f.requester end as id
        from public.friendships f
        where f.status = 'accepted' and (f.requester = me or f.addressee = me)
      ) o
      where public.gt_profile(o.id) is not null), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'roomId', r.id, 'roomName', r.name, 'invitedBy', public.gt_profile(m.invited_by)) order by m.created_at)
      from public.room_members m join public.rooms r on r.id = m.room_id
      where m.user_id = me and m.status = 'invited'), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'ownerId', r.owner,
        'members', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'profile', public.gt_profile(x.user_id),
            'status', x.status,
            -- Scores only once they've joined: someone just invited hasn't agreed to show the room.
            'thisWeek', case when x.status = 'joined' then public.gt_tally(x.user_id, this_week) end,
            'lastWeek', case when x.status = 'joined' then public.gt_tally(x.user_id, last_week) end,
            'streak', case when x.status = 'joined' then public.gt_streak(x.user_id, last_week) else 0 end)
            order by x.created_at), '[]'::jsonb)
          from public.room_members x
          where x.room_id = r.id and public.gt_profile(x.user_id) is not null)) order by r.created_at)
      from public.rooms r join public.room_members m on m.room_id = r.id
      where m.user_id = me and m.status = 'joined'), '[]'::jsonb)
  );
end;
$$;

-- ───────────── Who may call what ─────────────

revoke execute on function
  public.gt_is_friend(uuid, uuid), public.gt_profile(uuid), public.gt_tally(uuid, date), public.gt_streak(uuid, date),
  public.gt_username_available(text), public.gt_claim_profile(text, text),
  public.gt_request_friend(text), public.gt_answer_friend(uuid, boolean), public.gt_unfriend(uuid),
  public.gt_friend_records(uuid, date),
  public.gt_create_room(text, uuid[]), public.gt_invite_to_room(uuid, uuid[]),
  public.gt_answer_invite(uuid, boolean), public.gt_leave_room(uuid),
  public.gt_social_overview(date, date)
from public, anon, authenticated;

grant execute on function public.gt_username_available(text) to anon, authenticated;
grant execute on function
  public.gt_claim_profile(text, text),
  public.gt_request_friend(text), public.gt_answer_friend(uuid, boolean), public.gt_unfriend(uuid),
  public.gt_friend_records(uuid, date),
  public.gt_create_room(text, uuid[]), public.gt_invite_to_room(uuid, uuid[]),
  public.gt_answer_invite(uuid, boolean), public.gt_leave_room(uuid),
  public.gt_social_overview(date, date)
to authenticated;

-- Tell the Data API about the new functions now rather than on its next schema refresh.
notify pgrst, 'reload schema';
