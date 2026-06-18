-- Schema for the investing co-pilot. Run in the Supabase SQL editor.
-- One profile row per authenticated user, protected by row-level security.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  age int not null check (age between 18 and 100),
  goal text not null check (goal in ('retirement','growth','income','preservation','short_term')),
  risk_tolerance text not null check (risk_tolerance in ('conservative','moderate','aggressive')),
  horizon_years int not null check (horizon_years between 0 and 70),
  journey_stage text not null check (journey_stage in ('just_starting','building','established','nearing_goal')),
  monthly_contribution numeric check (monthly_contribution >= 0),
  interests text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user can only see and modify their own profile.
drop policy if exists "own profile - select" on public.profiles;
create policy "own profile - select" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own profile - upsert" on public.profiles;
create policy "own profile - upsert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "own profile - update" on public.profiles;
create policy "own profile - update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
