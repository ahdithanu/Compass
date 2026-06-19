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

-- Persisted history of every recommendation/insights run.
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('recommendation','insights')),
  trace_id text,
  reasoning_source text,
  data_source text,
  checks_passed int not null default 0,
  checks_total int not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists runs_user_created_idx on public.runs(user_id, created_at desc);

alter table public.runs enable row level security;
drop policy if exists "own runs - select" on public.runs;
create policy "own runs - select" on public.runs for select using (auth.uid() = user_id);
drop policy if exists "own runs - insert" on public.runs;
create policy "own runs - insert" on public.runs for insert with check (auth.uid() = user_id);

-- Normalized checker audit log: one row per gate result, per run.
create table if not exists public.run_checks (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage text not null,
  name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists run_checks_run_idx on public.run_checks(run_id);

alter table public.run_checks enable row level security;
drop policy if exists "own run_checks - select" on public.run_checks;
create policy "own run_checks - select" on public.run_checks for select using (auth.uid() = user_id);
drop policy if exists "own run_checks - insert" on public.run_checks;
create policy "own run_checks - insert" on public.run_checks for insert with check (auth.uid() = user_id);
