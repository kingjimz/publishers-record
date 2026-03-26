-- Optional label to organize publisher records within a service year (e.g. field ministry group).
-- Named publisher_group to avoid the reserved SQL keyword "group".

alter table public.publisher_records
  add column if not exists publisher_group text null;

comment on column public.publisher_records.publisher_group is
  'Optional group label for organizing publishers (per congregation needs).';

create index if not exists idx_publisher_records_service_year_publisher_group
  on public.publisher_records (service_year_start, publisher_group);
