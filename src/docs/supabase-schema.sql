create extension if not exists moddatetime schema extensions;

create table if not exists public.publisher_records (
  id uuid primary key default gen_random_uuid(),
  service_year_start integer not null check (service_year_start >= 2000 and service_year_start <= 2100),
  publisher_name text not null,
  date_of_birth date null,
  date_of_baptism date null,
  gender text null check (gender in ('male', 'female', 'other')),
  other_sheep boolean not null default false,
  anointed boolean not null default false,
  elder boolean not null default false,
  ministerial_servant boolean not null default false,
  regular_pioneer boolean not null default false,
  special_pioneer boolean not null default false,
  field_missionary boolean not null default false,
  months jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_year_start, publisher_name)
);

create index if not exists idx_publisher_records_service_year
  on public.publisher_records(service_year_start);

-- Optional: speeds up ILIKE name search across years (requires pg_trgm)
-- create extension if not exists pg_trgm;
-- create index if not exists idx_publisher_records_name_trgm
--   on public.publisher_records using gin (publisher_name gin_trgm_ops);

create trigger handle_publisher_records_updated_at
before update on public.publisher_records
for each row execute procedure extensions.moddatetime(updated_at);

alter table public.publisher_records enable row level security;

drop policy if exists "Single user full access" on public.publisher_records;
create policy "Single user full access"
on public.publisher_records
for all
to authenticated
using (true)
with check (true);
