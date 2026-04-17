-- Idempotent schema for Supabase (SQL editor or CLI). Safe to run multiple times.
-- Requires: authenticated role for RLS policies; extensions schema (Supabase default).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists moddatetime schema extensions;

-- Optional: speeds up ILIKE name search across years (requires pg_trgm)
-- create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- publisher_records
-- ---------------------------------------------------------------------------

create table if not exists public.publisher_records (
  id uuid primary key default gen_random_uuid(),
  service_year_start integer not null check (service_year_start >= 2000 and service_year_start <= 2100),
  publisher_name text not null,
  inactive boolean not null default false,
  date_of_birth date null,
  date_of_baptism date null,
  unbaptized_publisher boolean not null default false,
  unbaptized_approved_on date null,
  gender text null check (gender in ('male', 'female', 'other')),
  other_sheep boolean not null default false,
  anointed boolean not null default false,
  elder boolean not null default false,
  ministerial_servant boolean not null default false,
  regular_pioneer boolean not null default false,
  special_pioneer boolean not null default false,
  field_missionary boolean not null default false,
  publisher_group text null,
  months jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_year_start, publisher_name)
);

-- Older databases may predate publisher_group
alter table public.publisher_records
  add column if not exists publisher_group text null,
  add column if not exists inactive boolean not null default false,
  add column if not exists unbaptized_publisher boolean not null default false,
  add column if not exists unbaptized_approved_on date null;

create index if not exists idx_publisher_records_service_year
  on public.publisher_records (service_year_start);

create index if not exists idx_publisher_records_service_year_publisher_group
  on public.publisher_records (service_year_start, publisher_group);

-- create index if not exists idx_publisher_records_name_trgm
--   on public.publisher_records using gin (publisher_name gin_trgm_ops);

alter table public.publisher_records
  drop column if exists regular_pioneer_restarted_on;

-- ---------------------------------------------------------------------------
-- publisher_pioneer_profiles (current shape uses auxiliary_pioneer_periods jsonb)
-- ---------------------------------------------------------------------------

create table if not exists public.publisher_pioneer_profiles (
  publisher_name text primary key,
  auxiliary_pioneer_periods jsonb not null default '[]'::jsonb,
  regular_pioneer_periods jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.publisher_pioneer_profiles
  add column if not exists auxiliary_pioneer_periods jsonb not null default '[]'::jsonb,
  add column if not exists regular_pioneer_periods jsonb not null default '[]'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Legacy columns (only for one-time migration from publisher_records or old profiles)
alter table public.publisher_pioneer_profiles
  add column if not exists auxiliary_pioneer_approved_on date null,
  add column if not exists auxiliary_pioneer_ended_on date null;

-- Move per-year pioneer dates from publisher_records into profiles, then drop from records.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publisher_records'
      and column_name = 'auxiliary_pioneer_approved_on'
  ) then
    insert into public.publisher_pioneer_profiles (
      publisher_name,
      auxiliary_pioneer_approved_on,
      auxiliary_pioneer_ended_on,
      regular_pioneer_approved_on,
      regular_pioneer_stopped_on
    )
    select
      pr.publisher_name,
      (array_agg(pr.auxiliary_pioneer_approved_on order by pr.service_year_start desc)
        filter (where pr.auxiliary_pioneer_approved_on is not null))[1],
      (array_agg(pr.auxiliary_pioneer_ended_on order by pr.service_year_start desc)
        filter (where pr.auxiliary_pioneer_ended_on is not null))[1],
      (array_agg(pr.regular_pioneer_approved_on order by pr.service_year_start desc)
        filter (where pr.regular_pioneer_approved_on is not null))[1],
      (array_agg(pr.regular_pioneer_stopped_on order by pr.service_year_start desc)
        filter (where pr.regular_pioneer_stopped_on is not null))[1]
    from public.publisher_records pr
    group by pr.publisher_name
    having
      bool_or(pr.auxiliary_pioneer_approved_on is not null)
      or bool_or(pr.auxiliary_pioneer_ended_on is not null)
      or bool_or(pr.regular_pioneer_approved_on is not null)
      or bool_or(pr.regular_pioneer_stopped_on is not null)
    on conflict (publisher_name) do nothing;

    alter table public.publisher_records drop column if exists auxiliary_pioneer_approved_on;
    alter table public.publisher_records drop column if exists auxiliary_pioneer_ended_on;
    alter table public.publisher_records drop column if exists regular_pioneer_approved_on;
    alter table public.publisher_records drop column if exists regular_pioneer_stopped_on;
  end if;
end $$;

-- Fold legacy single auxiliary pair on profiles into auxiliary_pioneer_periods jsonb.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publisher_pioneer_profiles'
      and column_name = 'auxiliary_pioneer_approved_on'
  ) then
    update public.publisher_pioneer_profiles
    set auxiliary_pioneer_periods = jsonb_build_array(
      jsonb_build_object(
        'approved_on', auxiliary_pioneer_approved_on,
        'ended_on', auxiliary_pioneer_ended_on
      )
    )
    where auxiliary_pioneer_approved_on is not null
       or auxiliary_pioneer_ended_on is not null;

    alter table public.publisher_pioneer_profiles
      drop column if exists auxiliary_pioneer_approved_on,
      drop column if exists auxiliary_pioneer_ended_on;
  end if;
end $$;

-- Fold legacy single regular pair on profiles into regular_pioneer_periods jsonb.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publisher_pioneer_profiles'
      and column_name = 'regular_pioneer_approved_on'
  ) then
    update public.publisher_pioneer_profiles
    set regular_pioneer_periods = jsonb_build_array(
      jsonb_build_object(
        'approved_on', regular_pioneer_approved_on,
        'stopped_on', regular_pioneer_stopped_on
      )
    )
    where regular_pioneer_approved_on is not null
       or regular_pioneer_stopped_on is not null;

    alter table public.publisher_pioneer_profiles
      drop column if exists regular_pioneer_approved_on,
      drop column if exists regular_pioneer_stopped_on;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers (drop first so re-run is safe)
-- ---------------------------------------------------------------------------

drop trigger if exists handle_publisher_records_updated_at on public.publisher_records;
create trigger handle_publisher_records_updated_at
before update on public.publisher_records
for each row execute procedure extensions.moddatetime(updated_at);

drop trigger if exists handle_publisher_pioneer_profiles_updated_at on public.publisher_pioneer_profiles;
create trigger handle_publisher_pioneer_profiles_updated_at
before update on public.publisher_pioneer_profiles
for each row execute procedure extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.publisher_records enable row level security;

drop policy if exists "Single user full access" on public.publisher_records;
create policy "Single user full access"
on public.publisher_records
for all
to authenticated
using (true)
with check (true);

alter table public.publisher_pioneer_profiles enable row level security;

drop policy if exists "Single user full access" on public.publisher_pioneer_profiles;
create policy "Single user full access"
on public.publisher_pioneer_profiles
for all
to authenticated
using (true)
with check (true);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

comment on table public.publisher_pioneer_profiles is
  'Congregation tracking of auxiliary / regular pioneer milestone dates, one row per publisher name.';

comment on column public.publisher_pioneer_profiles.auxiliary_pioneer_periods is
  'JSON array of { approved_on, ended_on } (ISO dates) for each auxiliary pioneer stint; supports multiple periods per publisher.';

comment on column public.publisher_pioneer_profiles.regular_pioneer_periods is
  'JSON array of { approved_on, stopped_on } (ISO dates) for each regular pioneer stint; latest row with null stopped_on means currently active.';

comment on column public.publisher_records.publisher_group is
  'Optional group label for organizing publishers (per congregation needs).';
