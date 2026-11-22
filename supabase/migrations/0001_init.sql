-- Gym Tracker schema. Paste into Supabase → SQL Editor → Run (safe to run again).
--
-- One table per record type. Each row holds one app record as JSON (`data`), plus the
-- columns sync needs. Row-level security means a signed-in user can only ever see and
-- change their own rows, so the public key in the website can't read anyone's data.

-- Keeps whichever copy of a record was edited last (an offline phone may upload an older
-- copy after a newer one), and stamps server time so devices can ask "what changed since…".
create or replace function public.gt_keep_newest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

-- Workout days (Upper 1, Lower, …) with their exercises
create table if not exists public.workout_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

-- Sessions: one per workout day per date (id = "<workout day id>:<YYYY-MM-DD>")
create table if not exists public.sessions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

-- The weekly split
create table if not exists public.splits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index if not exists workout_days_pull_idx on public.workout_days (user_id, server_updated_at);
create index if not exists sessions_pull_idx on public.sessions (user_id, server_updated_at);
create index if not exists splits_pull_idx on public.splits (user_id, server_updated_at);

alter table public.workout_days enable row level security;
alter table public.sessions enable row level security;
alter table public.splits enable row level security;

drop policy if exists "own rows" on public.workout_days;
create policy "own rows" on public.workout_days for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own rows" on public.sessions;
create policy "own rows" on public.sessions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own rows" on public.splits;
create policy "own rows" on public.splits for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop trigger if exists keep_newest on public.workout_days;
create trigger keep_newest before insert or update on public.workout_days
  for each row execute function public.gt_keep_newest();

drop trigger if exists keep_newest on public.sessions;
create trigger keep_newest before insert or update on public.sessions
  for each row execute function public.gt_keep_newest();

drop trigger if exists keep_newest on public.splits;
create trigger keep_newest before insert or update on public.splits
  for each row execute function public.gt_keep_newest();

grant select, insert, update, delete on public.workout_days, public.sessions, public.splits to authenticated;
