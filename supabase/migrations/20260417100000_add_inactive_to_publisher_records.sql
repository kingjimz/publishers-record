alter table public.publisher_records
  add column if not exists inactive boolean not null default false;
