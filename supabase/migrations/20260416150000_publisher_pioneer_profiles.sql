-- Per-publisher pioneer milestone dates (not tied to a service year).

create table if not exists public.publisher_pioneer_profiles (
  publisher_name text primary key,
  auxiliary_pioneer_approved_on date null,
  auxiliary_pioneer_ended_on date null,
  regular_pioneer_approved_on date null,
  regular_pioneer_stopped_on date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger handle_publisher_pioneer_profiles_updated_at
before update on public.publisher_pioneer_profiles
for each row execute procedure extensions.moddatetime(updated_at);

alter table public.publisher_pioneer_profiles enable row level security;

drop policy if exists "Single user full access" on public.publisher_pioneer_profiles;
create policy "Single user full access"
on public.publisher_pioneer_profiles
for all
to authenticated
using (true)
with check (true);

-- Move legacy per-year columns into profiles, then drop them from publisher_records.
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

comment on table public.publisher_pioneer_profiles is
  'Congregation tracking of auxiliary / regular pioneer milestone dates, one row per publisher name.';
